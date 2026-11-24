import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AuditLog,
  FileEntity,
  Provider,
  ProviderBranch,
  ProviderDocument,
  ProviderService,
  VerificationStatus,
} from '../../database/entities';
import { AuthUser, isAdminLike } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { normalizePhone } from '../../common/utils/phone';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import {
  AddDocumentDto,
  AdminProvidersQuery,
  BranchDto,
  ProviderStatusDto,
  PublicProvidersQuery,
  ServiceDto,
  UpdateBranchDto,
  UpdateProviderDto,
  UpdateServiceDto,
} from './providers.dto';

const TRANSITIONS: Record<string, { from: VerificationStatus[]; to: VerificationStatus; action: string }> = {
  APPROVE: { from: [VerificationStatus.PENDING, VerificationStatus.REJECTED], to: VerificationStatus.APPROVED, action: 'PROVIDER_APPROVED' },
  REJECT: { from: [VerificationStatus.PENDING], to: VerificationStatus.REJECTED, action: 'PROVIDER_REJECTED' },
  SUSPEND: { from: [VerificationStatus.APPROVED], to: VerificationStatus.SUSPENDED, action: 'PROVIDER_SUSPENDED' },
  ACTIVATE: { from: [VerificationStatus.SUSPENDED], to: VerificationStatus.APPROVED, action: 'PROVIDER_ACTIVATED' },
};

const STATUS_MESSAGES: Record<string, { title: string; body: (note?: string) => string }> = {
  APPROVE: { title: 'تم اعتماد حسابك 🎉', body: () => 'تمت مراجعة بياناتك واعتماد حسابك، وأصبح ملفك ظاهراً للمرضى الآن.' },
  REJECT: { title: 'لم يتم اعتماد الحساب', body: (n) => `نأسف، لم يتم اعتماد حسابك.${n ? ` السبب: ${n}` : ''}` },
  SUSPEND: { title: 'تم إيقاف الحساب مؤقتاً', body: (n) => `تم إيقاف ظهور حسابك مؤقتاً.${n ? ` السبب: ${n}` : ''}` },
  ACTIVATE: { title: 'تم إعادة تفعيل حسابك', body: () => 'تم إعادة تفعيل حسابك وأصبح ظاهراً للمرضى.' },
};

@Injectable()
export class ProvidersService {
  constructor(
    private ds: DataSource,
    @InjectRepository(Provider) private providers: Repository<Provider>,
    @InjectRepository(ProviderBranch) private branches: Repository<ProviderBranch>,
    @InjectRepository(ProviderService) private services: Repository<ProviderService>,
    @InjectRepository(ProviderDocument) private documents: Repository<ProviderDocument>,
    private access: AccessPolicyService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private loader: AuthUserLoader,
  ) {}

  /** Publicly visible = approved + active + owner account active. */
  isPublic(p: Provider) {
    return p.verificationStatus === VerificationStatus.APPROVED && p.isActive && p.subscriptionActive !== false;
  }

  // ─────────────── Public ───────────────

  async searchPublic(q: PublicProvidersQuery) {
    const qb = this.providers
      .createQueryBuilder('p')
      .innerJoin('p.owner', 'o', "o.status = 'ACTIVE'")
      .leftJoinAndSelect('p.branches', 'b', 'b.isActive = true')
      .leftJoinAndSelect('b.city', 'bc')
      .leftJoinAndSelect('b.area', 'ba')
      .where('p.verificationStatus = :st AND p.isActive = true AND p.subscriptionActive = true', { st: VerificationStatus.APPROVED });
    if (q.type) qb.andWhere('p.type = :type', { type: q.type });
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      qb.andWhere('(p.nameAr ILIKE :s OR p.nameEn ILIKE :s OR p.description ILIKE :s)', { s });
    }
    const loc: string[] = [];
    if (q.areaId) loc.push('xb.area_id = :areaId');
    else if (q.cityId) loc.push('xb.city_id = :cityId');
    else if (q.governorateId) loc.push('xc.governorate_id = :governorateId');
    if (loc.length) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM provider_branches xb LEFT JOIN cities xc ON xc.id = xb.city_id
                  WHERE xb.provider_id = p.id AND xb.is_active AND ${loc.join(' AND ')})`,
        { areaId: q.areaId, cityId: q.cityId, governorateId: q.governorateId },
      );
    }
    if (q.minRating) qb.andWhere('p.ratingAvg >= :mr', { mr: q.minRating });
    if (q.homeService) qb.andWhere('p.homeServiceAvailable = true');
    if (q.sort === 'name') qb.orderBy('p.nameAr', 'ASC');
    else if (q.sort === 'newest') qb.orderBy('p.createdAt', 'DESC');
    else qb.orderBy('p.ratingAvg', 'DESC').addOrderBy('p.ratingCount', 'DESC');
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(items, total, q);
  }

  async getPublic(idOrSlug: string, viewer?: AuthUser) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const p = await this.providers.findOne({
      where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
      relations: { branches: { city: true, area: true }, services: true, owner: true },
    });
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    const canSeeHidden = viewer && (viewer.providerIds.includes(p.id) || viewer.permissions.has(P.PROVIDERS_READ_ANY));
    if ((!this.isPublic(p) || p.owner?.status !== 'ACTIVE') && !canSeeHidden) {
      throw new NotFoundException('مقدم الخدمة غير موجود');
    }
    const { owner: _o, ...rest } = p;
    return {
      ...rest,
      branches: p.branches?.filter((b) => b.isActive || canSeeHidden),
      services: p.services?.filter((s) => s.isActive || canSeeHidden),
    };
  }

  // ─────────────── Own management ───────────────

  async mine(user: AuthUser) {
    if (!user.providerIds.length) return [];
    return this.providers
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.branches', 'b')
      .leftJoinAndSelect('p.services', 's')
      .leftJoinAndSelect('p.documents', 'd')
      .leftJoinAndSelect('d.file', 'f')
      .where('p.id IN (:...ids)', { ids: user.providerIds })
      .orderBy('b.createdAt', 'ASC')
      .getMany();
  }

  private async assertFileOwned(user: AuthUser, fileId: string, purpose: string) {
    const f = await this.ds.getRepository(FileEntity).findOneBy({ id: fileId, purpose });
    if (!f || (f.uploadedById !== user.id && !user.permissions.has(P.PROVIDERS_MANAGE_ANY))) {
      throw new BadRequestException('الملف غير صالح');
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateProviderDto) {
    this.access.assertCanManageProvider(user, id);
    const old = await this.providers.findOneBy({ id });
    if (!old) throw new NotFoundException('مقدم الخدمة غير موجود');
    if (dto.logoFileId) await this.assertFileOwned(user, dto.logoFileId, 'PROVIDER_LOGO');
    const patch: Record<string, any> = { ...dto };
    if (dto.phone !== undefined) patch.phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.whatsappNumber !== undefined) {
      const w = dto.whatsappNumber ? normalizePhone(dto.whatsappNumber) : null;
      if (dto.whatsappNumber && !w) throw new BadRequestException('رقم الواتساب غير صحيح');
      patch.whatsappNumber = w;
    }
    if (dto.email) patch.email = dto.email.toLowerCase();
    await this.providers.update(id, patch);
    await this.audit.log({ userId: user.id, action: 'PROVIDER_UPDATED', entity: 'providers', entityId: id, oldValue: old, newValue: dto });
    return this.providers.findOneBy({ id });
  }

  // Branches
  async listBranches(user: AuthUser, providerId: string) {
    this.access.assertCanManageProvider(user, providerId);
    return this.branches.find({ where: { providerId }, relations: { city: true, area: true }, order: { createdAt: 'ASC' } });
  }

  async addBranch(user: AuthUser, providerId: string, dto: BranchDto) {
    this.access.assertCanManageProvider(user, providerId);
    const b = await this.branches.save(
      this.branches.create({ ...dto, providerId, phone: dto.phone ? normalizePhone(dto.phone) : null }),
    );
    await this.audit.log({ userId: user.id, action: 'BRANCH_CREATED', entity: 'provider_branches', entityId: b.id, newValue: dto });
    return b;
  }

  private async ownBranch(user: AuthUser, providerId: string, branchId: string) {
    this.access.assertCanManageProvider(user, providerId);
    const b = await this.branches.findOneBy({ id: branchId, providerId });
    if (!b) throw new NotFoundException('الفرع غير موجود');
    return b;
  }

  async updateBranch(user: AuthUser, providerId: string, branchId: string, dto: UpdateBranchDto) {
    const old = await this.ownBranch(user, providerId, branchId);
    const patch: any = { ...dto };
    if (dto.phone !== undefined) patch.phone = dto.phone ? normalizePhone(dto.phone) : null;
    await this.branches.update(branchId, patch);
    await this.audit.log({ userId: user.id, action: 'BRANCH_UPDATED', entity: 'provider_branches', entityId: branchId, oldValue: old, newValue: dto });
    return this.branches.findOneBy({ id: branchId });
  }

  /** Hard delete when unused; if history references the branch it is deactivated instead. */
  async deleteBranch(user: AuthUser, providerId: string, branchId: string) {
    await this.ownBranch(user, providerId, branchId);
    try {
      const used = await this.ds.query(`SELECT 1 FROM appointments WHERE branch_id = $1 LIMIT 1`, [branchId]);
      if (used.length) throw new Error('referenced');
      await this.branches.delete(branchId);
      await this.audit.log({ userId: user.id, action: 'BRANCH_DELETED', entity: 'provider_branches', entityId: branchId });
      return { deleted: true };
    } catch (e) {
      if (e instanceof QueryFailedError || (e as Error).message === 'referenced') {
        await this.branches.update(branchId, { isActive: false });
        await this.audit.log({ userId: user.id, action: 'BRANCH_DEACTIVATED', entity: 'provider_branches', entityId: branchId });
        return { deleted: false, deactivated: true };
      }
      throw e;
    }
  }

  // Services
  async listServices(user: AuthUser, providerId: string) {
    this.access.assertCanManageProvider(user, providerId);
    return this.services.find({ where: { providerId }, order: { createdAt: 'ASC' } });
  }

  async addService(user: AuthUser, providerId: string, dto: ServiceDto) {
    this.access.assertCanManageProvider(user, providerId);
    return this.services.save(this.services.create({ ...dto, providerId }));
  }

  async updateService(user: AuthUser, providerId: string, serviceId: string, dto: UpdateServiceDto) {
    this.access.assertCanManageProvider(user, providerId);
    const res = await this.services.update({ id: serviceId, providerId }, dto);
    if (!res.affected) throw new NotFoundException('الخدمة غير موجودة');
    return this.services.findOneBy({ id: serviceId });
  }

  async deleteService(user: AuthUser, providerId: string, serviceId: string) {
    this.access.assertCanManageProvider(user, providerId);
    const res = await this.services.delete({ id: serviceId, providerId });
    if (!res.affected) throw new NotFoundException('الخدمة غير موجودة');
    return { deleted: true };
  }

  // Verification documents
  async addDocument(user: AuthUser, providerId: string, dto: AddDocumentDto) {
    this.access.assertCanManageProvider(user, providerId);
    await this.assertFileOwned(user, dto.fileId, 'PROVIDER_DOCUMENT');
    const d = await this.documents.save(this.documents.create({ providerId, fileId: dto.fileId, type: dto.type, note: dto.note ?? null }));
    await this.audit.log({ userId: user.id, action: 'PROVIDER_DOCUMENT_ADDED', entity: 'provider_documents', entityId: d.id, newValue: { type: dto.type } });
    return d;
  }

  async listDocuments(user: AuthUser, providerId: string) {
    if (!user.providerIds.includes(providerId) && !user.permissions.has(P.PROVIDERS_READ_ANY)) {
      throw new ForbiddenException('غير مصرح');
    }
    return this.documents.find({ where: { providerId }, relations: { file: true }, order: { createdAt: 'DESC' } });
  }

  async deleteDocument(user: AuthUser, providerId: string, documentId: string) {
    this.access.assertCanManageProvider(user, providerId);
    const d = await this.documents.findOneBy({ id: documentId, providerId });
    if (!d) throw new NotFoundException('المستند غير موجود');
    if (d.verifiedAt && !isAdminLike(user)) throw new BadRequestException('لا يمكن حذف مستند تم التحقق منه');
    await this.documents.delete(documentId);
    return { deleted: true };
  }

  // ─────────────── Admin ───────────────

  async adminList(q: AdminProvidersQuery) {
    const qb = this.providers
      .createQueryBuilder('p')
      .leftJoin('p.owner', 'o')
      .addSelect(['o.id', 'o.fullName', 'o.phone', 'o.email', 'o.status'])
      .loadRelationCountAndMap('p.documentCount', 'p.documents')
      .loadRelationCountAndMap('p.branchCount', 'p.branches')
      .orderBy('p.createdAt', 'DESC');
    if (q.type) qb.andWhere('p.type = :type', { type: q.type });
    if (q.status) qb.andWhere('p.verificationStatus = :st', { st: q.status });
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      qb.andWhere('(p.nameAr ILIKE :s OR p.nameEn ILIKE :s OR o.phone ILIKE :s OR o.email ILIKE :s)', { s });
    }
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(items, total, q);
  }

  async adminGet(id: string) {
    const p = await this.providers
      .createQueryBuilder('p')
      .leftJoin('p.owner', 'o')
      .addSelect(['o.id', 'o.fullName', 'o.phone', 'o.email', 'o.status', 'o.createdAt', 'o.lastLoginAt'])
      .leftJoinAndSelect('p.branches', 'b')
      .leftJoinAndSelect('p.services', 's')
      .leftJoinAndSelect('p.documents', 'd')
      .leftJoinAndSelect('d.file', 'f')
      .leftJoinAndSelect('p.doctor', 'doc')
      .leftJoinAndSelect('doc.specialties', 'ds')
      .leftJoinAndSelect('ds.specialty', 'spec')
      .where('p.id = :id', { id })
      .getOne();
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    const activity = await this.ds.getRepository(AuditLog).find({
      where: [
        { entity: 'providers', entityId: id },
        { userId: p.ownerUserId },
      ],
      order: { createdAt: 'DESC' },
      take: 30,
    });
    const [stats] = await this.ds.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
         FROM appointments WHERE provider_id = $1`,
      [id],
    );
    return { ...p, activity, stats };
  }

  async changeStatus(admin: AuthUser, id: string, dto: ProviderStatusDto) {
    const t = TRANSITIONS[dto.action];
    const p = await this.providers.findOneBy({ id });
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    if (!t.from.includes(p.verificationStatus)) {
      throw new BadRequestException(`لا يمكن تنفيذ هذا الإجراء على حساب حالته ${p.verificationStatus}`);
    }
    if ((dto.action === 'REJECT' || dto.action === 'SUSPEND') && !dto.note) {
      throw new BadRequestException('من فضلك اكتب سبب الرفض/الإيقاف');
    }
    await this.ds.transaction(async (m) => {
      await m.update(Provider, { id }, {
        verificationStatus: t.to,
        verificationNote: dto.note ?? null,
        verifiedAt: t.to === VerificationStatus.APPROVED ? new Date() : p.verifiedAt,
      });
      await this.audit.log(
        { userId: admin.id, action: t.action, entity: 'providers', entityId: id, oldValue: { status: p.verificationStatus }, newValue: { status: t.to, note: dto.note } },
        m,
      );
    });
    this.loader.invalidate(p.ownerUserId);
    const msg = STATUS_MESSAGES[dto.action];
    await this.notifications.notify(p.ownerUserId, {
      type: t.action,
      category: 'SYSTEM',
      title: msg.title,
      body: msg.body(dto.note),
      data: { providerId: id },
      force: true,
    });
    return this.adminGet(id);
  }

  async verifyDocument(admin: AuthUser, providerId: string, documentId: string) {
    const d = await this.documents.findOneBy({ id: documentId, providerId });
    if (!d) throw new NotFoundException('المستند غير موجود');
    await this.documents.update(documentId, { verifiedAt: new Date(), verifiedById: admin.id });
    await this.audit.log({ userId: admin.id, action: 'PROVIDER_DOCUMENT_VERIFIED', entity: 'provider_documents', entityId: documentId });
    return this.documents.findOne({ where: { id: documentId }, relations: { file: true } });
  }
}
