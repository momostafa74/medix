import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  Provider,
  ProviderBranch,
  RadiologyBranchModality,
  RadiologyCenter,
  RadiologyOrder,
  RadiologyService,
  VerificationStatus,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { validHours } from '../labs/lab-logic';
import { MODALITIES } from './radiology-logic';
import { ModalityUnitDto, RadiologyServiceDto, SearchServicesQuery, UpdateCenterSettingsDto } from './radiology.dto';

@Injectable()
export class RadiologyCatalogService {
  constructor(
    private ds: DataSource,
    private access: AccessPolicyService,
    private audit: AuditService,
  ) {}

  /** The radiology center the current user works for (owner or active staff). */
  async myCenter(user: AuthUser, m: EntityManager = this.ds.manager) {
    if (!user.providerIds.length) throw new ForbiddenException('هذا الحساب غير مرتبط بمركز أشعة');
    const center = await m.findOne(RadiologyCenter, { where: { providerId: In(user.providerIds) }, relations: { provider: true } });
    if (!center) throw new ForbiddenException('هذا الحساب غير مرتبط بمركز أشعة');
    return { center, provider: center.provider! };
  }

  private assertManage(user: AuthUser, providerId: string) {
    if (!user.permissions.has(P.RADIOLOGY_CATALOG_MANAGE) && !user.permissions.has(P.PROVIDERS_MANAGE_ANY)) {
      throw new ForbiddenException('لا تملك صلاحية تعديل خدمات المركز');
    }
    this.access.assertCanManageProvider(user, providerId);
  }

  /** Public lookup — approved, active centers with an active owner only. */
  async publicCenter(key: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const c = await this.ds
      .getRepository(RadiologyCenter)
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.provider', 'p')
      .innerJoin('p.owner', 'o', "o.status = 'ACTIVE'")
      .where(isUuid ? '(p.id = :k OR c.id = :k)' : 'p.slug = :k', { k: key })
      .andWhere('p.verificationStatus = :st AND p.isActive = true AND p.subscriptionActive = true', { st: VerificationStatus.APPROVED })
      .getOne();
    if (!c) throw new NotFoundException('مركز الأشعة غير موجود أو غير متاح حالياً');
    return c;
  }

  async unitsFor(centerId: string, m: EntityManager = this.ds.manager) {
    return m.find(RadiologyBranchModality, { where: { centerId } });
  }

  // ─────────────── Settings ───────────────

  async mySettings(user: AuthUser) {
    const { center, provider } = await this.myCenter(user);
    const [branches, units, counts] = await Promise.all([
      this.ds.getRepository(ProviderBranch).find({ where: { providerId: provider.id }, order: { createdAt: 'ASC' } }),
      this.unitsFor(center.id),
      this.ds.query(`SELECT count(*)::int AS services, array_agg(DISTINCT modality) FILTER (WHERE is_active) AS modalities FROM radiology_services WHERE center_id = $1`, [center.id]),
    ]);
    const offered: string[] = counts[0].modalities || [];
    const bookable = branches.filter((b) => b.isActive && b.openingHours?.length && units.some((u) => u.branchId === b.id && u.units > 0));
    const { provider: _p, ...rest } = center;
    return {
      ...rest,
      provider: { id: provider.id, nameAr: provider.nameAr, slug: provider.slug, verificationStatus: provider.verificationStatus },
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        isActive: b.isActive,
        openingHours: b.openingHours,
        modalities: units.filter((u) => u.branchId === b.id).map((u) => ({ modality: u.modality, units: u.units })),
      })),
      modalityLabels: MODALITIES,
      offeredModalities: offered,
      counts: { services: counts[0].services },
      setupWarnings: [
        ...(counts[0].services ? [] : ['NO_SERVICES']),
        ...(branches.some((b) => b.isActive && b.openingHours?.length) ? [] : ['BRANCH_HOURS_MISSING']),
        ...(bookable.length || !offered.length ? [] : ['NO_DEVICES']),
      ],
    };
  }

  async updateSettings(user: AuthUser, dto: UpdateCenterSettingsDto) {
    const { center, provider } = await this.myCenter(user);
    this.access.assertCanManageProvider(user, provider.id);
    await this.ds.getRepository(RadiologyCenter).update(center.id, { ...dto } as any);
    await this.audit.log({ userId: user.id, action: 'RADIOLOGY_SETTINGS_UPDATED', entity: 'radiology_centers', entityId: center.id, oldValue: center, newValue: dto });
    return this.mySettings(user);
  }

  async setBranchHours(user: AuthUser, branchId: string, hours: { day: number; open: number; close: number }[]) {
    const { provider } = await this.myCenter(user);
    this.access.assertCanManageProvider(user, provider.id);
    if (!validHours(hours)) throw new BadRequestException('مواعيد العمل غير صحيحة (وقت البداية يجب أن يسبق النهاية)');
    const res = await this.ds.getRepository(ProviderBranch).update({ id: branchId, providerId: provider.id }, { openingHours: hours });
    if (!res.affected) throw new NotFoundException('الفرع غير موجود');
    await this.audit.log({ userId: user.id, action: 'BRANCH_HOURS_UPDATED', entity: 'provider_branches', entityId: branchId, newValue: hours });
    return { ok: true };
  }

  /** Machines per modality in a branch (0 = modality not offered there). */
  async setBranchModalities(user: AuthUser, branchId: string, list: ModalityUnitDto[]) {
    const { center, provider } = await this.myCenter(user);
    this.access.assertCanManageProvider(user, provider.id);
    if (!(await this.ds.getRepository(ProviderBranch).exists({ where: { id: branchId, providerId: provider.id } }))) throw new NotFoundException('الفرع غير موجود');
    if (new Set(list.map((x) => x.modality)).size !== list.length) throw new BadRequestException('نوع جهاز مكرر');
    await this.ds.transaction(async (m) => {
      await m.delete(RadiologyBranchModality, { branchId });
      const rows = list.filter((x) => x.units > 0).map((x) => m.create(RadiologyBranchModality, { centerId: center.id, branchId, modality: x.modality, units: x.units }));
      if (rows.length) await m.save(rows);
      const all = await m.query(`SELECT DISTINCT modality FROM radiology_branch_modalities WHERE center_id = $1`, [center.id]);
      await m.update(RadiologyCenter, center.id, { modalities: all.map((r: any) => r.modality) });
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_DEVICES_UPDATED', entity: 'provider_branches', entityId: branchId, newValue: list }, m);
    });
    return this.mySettings(user);
  }

  // ─────────────── Services ───────────────

  async myServices(user: AuthUser, q: SearchServicesQuery) {
    const { center } = await this.myCenter(user);
    const qb = this.ds.getRepository(RadiologyService).createQueryBuilder('s').where('s.centerId = :id', { id: center.id });
    if (q.search) qb.andWhere('s.name ILIKE :q', { q: `%${likeEscape(q.search)}%` });
    if (q.modality) qb.andWhere('s.modality = :m', { m: q.modality });
    qb.orderBy('s.modality', 'ASC').addOrderBy('s.name', 'ASC');
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(items, total, q);
  }

  async createService(user: AuthUser, dto: RadiologyServiceDto) {
    const { center, provider } = await this.myCenter(user);
    this.assertManage(user, provider.id);
    const s = await this.ds.getRepository(RadiologyService).save(this.ds.getRepository(RadiologyService).create({ ...dto, centerId: center.id } as any));
    await this.audit.log({ userId: user.id, action: 'RADIOLOGY_SERVICE_CREATED', entity: 'radiology_services', entityId: (s as any).id, newValue: { name: dto.name, price: dto.price } });
    return s;
  }

  async updateService(user: AuthUser, id: string, dto: RadiologyServiceDto) {
    const { center, provider } = await this.myCenter(user);
    this.assertManage(user, provider.id);
    const old = await this.ds.getRepository(RadiologyService).findOneBy({ id, centerId: center.id });
    if (!old) throw new NotFoundException('الخدمة غير موجودة');
    await this.ds.getRepository(RadiologyService).update(id, dto as any);
    await this.audit.log({ userId: user.id, action: 'RADIOLOGY_SERVICE_UPDATED', entity: 'radiology_services', entityId: id, oldValue: { name: old.name, price: old.price }, newValue: { name: dto.name, price: dto.price } });
    return this.ds.getRepository(RadiologyService).findOneBy({ id });
  }

  /** Services with bookings are deactivated instead of deleted. */
  async deleteService(user: AuthUser, id: string) {
    const { center, provider } = await this.myCenter(user);
    this.assertManage(user, provider.id);
    const s = await this.ds.getRepository(RadiologyService).findOneBy({ id, centerId: center.id });
    if (!s) throw new NotFoundException('الخدمة غير موجودة');
    if (await this.ds.getRepository(RadiologyOrder).exists({ where: { serviceId: id } })) {
      await this.ds.getRepository(RadiologyService).update(id, { isActive: false });
      return { deleted: false, deactivated: true };
    }
    await this.ds.getRepository(RadiologyService).delete(id);
    await this.audit.log({ userId: user.id, action: 'RADIOLOGY_SERVICE_DELETED', entity: 'radiology_services', entityId: id, oldValue: { name: s.name } });
    return { deleted: true };
  }

  // ─────────────── Public ───────────────

  async publicCatalog(key: string) {
    const c = await this.publicCenter(key);
    const [services, branches, units] = await Promise.all([
      this.ds.getRepository(RadiologyService).find({ where: { centerId: c.id, isActive: true }, order: { modality: 'ASC', name: 'ASC' } }),
      this.ds.getRepository(ProviderBranch).find({ where: { providerId: c.providerId, isActive: true }, relations: { city: true, area: true }, order: { createdAt: 'ASC', name: 'ASC' } }),
      this.unitsFor(c.id),
    ]);
    const p = c.provider!;
    return {
      center: { id: c.id, accreditation: c.accreditation, bookingHorizonDays: c.bookingHorizonDays, modalities: c.modalities },
      provider: { id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, logoFileId: p.logoFileId, phone: p.phone, whatsappNumber: p.whatsappNumber, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, description: p.description },
      modalityLabels: MODALITIES,
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
        city: b.city?.nameAr,
        area: b.area?.nameAr,
        openingHours: b.openingHours,
        modalities: b.openingHours?.length ? units.filter((u) => u.branchId === b.id && u.units > 0).map((u) => u.modality) : [],
      })),
      services: services.map((s) => ({
        id: s.id,
        modality: s.modality,
        name: s.name,
        description: s.description,
        price: s.price,
        durationMinutes: s.durationMinutes,
        preparationInstructions: s.preparationInstructions,
        requiresReferral: s.requiresReferral,
        turnaroundHours: s.turnaroundHours,
      })),
    };
  }

  /** Cross-center service search (by name and/or modality), cheapest first. */
  async searchServices(q: SearchServicesQuery) {
    const params: unknown[] = [];
    const where = [`s.is_active`, `p.verification_status = 'APPROVED'`, `p.is_active`, `p.subscription_active`, `o.status = 'ACTIVE'`];
    if (q.search) (params.push(`%${likeEscape(q.search)}%`), where.push(`(s.name ILIKE $${params.length} OR s.description ILIKE $${params.length})`));
    if (q.modality) (params.push(q.modality), where.push(`s.modality = $${params.length}`));
    const loc: string[] = [];
    if (q.areaId) (params.push(q.areaId), loc.push(`xb.area_id = $${params.length}`));
    else if (q.cityId) (params.push(q.cityId), loc.push(`xb.city_id = $${params.length}`));
    else if (q.governorateId) (params.push(q.governorateId), loc.push(`xc.governorate_id = $${params.length}`));
    if (loc.length) where.push(`EXISTS (SELECT 1 FROM provider_branches xb LEFT JOIN cities xc ON xc.id = xb.city_id WHERE xb.provider_id = p.id AND xb.is_active AND ${loc.join(' AND ')})`);
    const from = `FROM radiology_services s JOIN radiology_centers c ON c.id = s.center_id JOIN providers p ON p.id = c.provider_id JOIN users o ON o.id = p.owner_user_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT s.id, s.modality, s.name, s.price::float AS price, s.duration_minutes, s.requires_referral, s.preparation_instructions,
              p.id AS provider_id, p.slug, p.name_ar, p.logo_file_id, p.rating_avg::float AS rating_avg
         ${from} ORDER BY s.price ASC, s.name LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        serviceId: r.id,
        modality: r.modality,
        name: r.name,
        price: r.price,
        durationMinutes: r.duration_minutes,
        requiresReferral: r.requires_referral,
        preparationInstructions: r.preparation_instructions,
        center: { providerId: r.provider_id, slug: r.slug, nameAr: r.name_ar, logoFileId: r.logo_file_id, ratingAvg: r.rating_avg },
      })),
      total,
      q,
    );
  }

  async adminCatalog(providerId: string) {
    const c = await this.ds.getRepository(RadiologyCenter).findOne({ where: { providerId } });
    if (!c) throw new NotFoundException('مركز الأشعة غير موجود');
    const services = await this.ds.getRepository(RadiologyService).find({ where: { centerId: c.id }, order: { modality: 'ASC' } });
    return { center: c, services, units: await this.unitsFor(c.id) };
  }

  async providerOf(centerId: string): Promise<Provider> {
    const c = await this.ds.getRepository(RadiologyCenter).findOne({ where: { id: centerId }, relations: { provider: true } });
    if (!c) throw new NotFoundException('مركز الأشعة غير موجود');
    return c.provider!;
  }
}
