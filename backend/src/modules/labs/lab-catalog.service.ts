import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  LabOrderItem,
  LabPackage,
  LabPackageItem,
  LabResultItem,
  LabTest,
  LabTestCategory,
  LabTestParameter,
  LabTestRange,
  Laboratory,
  Provider,
  ProviderBranch,
  VerificationStatus,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import {
  CatalogTestsQuery,
  CategoryDto,
  PackageDto,
  ParameterDto,
  SearchTestsQuery,
  TestDto,
  UpdateLabSettingsDto,
} from './labs.dto';
import { validHours } from './lab-logic';

export interface MyLab {
  lab: Laboratory;
  provider: Provider;
}

@Injectable()
export class LabCatalogService {
  constructor(
    private ds: DataSource,
    private access: AccessPolicyService,
    private audit: AuditService,
  ) {}

  // ─────────────── Resolution helpers ───────────────

  /** The laboratory the current user works for (owner or active staff). IDs from the client are never used here. */
  async myLab(user: AuthUser, m: EntityManager = this.ds.manager): Promise<MyLab> {
    if (!user.providerIds.length) throw new ForbiddenException('هذا الحساب غير مرتبط بمعمل');
    const lab = await m.findOne(Laboratory, { where: { providerId: In(user.providerIds) }, relations: { provider: true } });
    if (!lab) throw new ForbiddenException('هذا الحساب غير مرتبط بمعمل');
    return { lab, provider: lab.provider! };
  }

  private assertManage(user: AuthUser, providerId: string) {
    if (!user.permissions.has(P.LAB_CATALOG_MANAGE) && !user.permissions.has(P.PROVIDERS_MANAGE_ANY)) {
      throw new ForbiddenException('لا تملك صلاحية تعديل كتالوج المعمل');
    }
    this.access.assertCanManageProvider(user, providerId);
  }

  /** Public lookup by provider id/slug — only approved, active labs with an active owner. */
  async publicLab(key: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const lab = await this.ds
      .getRepository(Laboratory)
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.provider', 'p')
      .innerJoin('p.owner', 'o', "o.status = 'ACTIVE'")
      .where(isUuid ? '(p.id = :k OR l.id = :k)' : 'p.slug = :k', { k: key })
      .andWhere('p.verificationStatus = :st AND p.isActive = true AND p.subscriptionActive = true', { st: VerificationStatus.APPROVED })
      .getOne();
    if (!lab) throw new NotFoundException('المعمل غير موجود أو غير متاح حالياً');
    return lab;
  }

  // ─────────────── Lab settings ───────────────

  async mySettings(user: AuthUser) {
    const { lab, provider } = await this.myLab(user);
    const branches = await this.ds.getRepository(ProviderBranch).find({ where: { providerId: provider.id }, order: { createdAt: 'ASC' } });
    const counts = await this.ds.query(
      `SELECT (SELECT count(*) FROM lab_tests WHERE laboratory_id = $1 AND is_active)::int AS tests,
              (SELECT count(*) FROM lab_packages WHERE laboratory_id = $1 AND is_active)::int AS packages`,
      [lab.id],
    );
    const { provider: _p, ...rest } = lab;
    return {
      ...rest,
      provider: { id: provider.id, nameAr: provider.nameAr, slug: provider.slug, verificationStatus: provider.verificationStatus, type: provider.type },
      branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, isActive: b.isActive, openingHours: b.openingHours })),
      counts: counts[0],
      setupWarnings: [
        ...(branches.some((b) => b.isActive && b.openingHours?.length) ? [] : ['BRANCH_HOURS_MISSING']),
        ...(lab.homeCollection && !lab.homeCollectionHours?.length ? ['HOME_HOURS_MISSING'] : []),
        ...(counts[0].tests ? [] : ['NO_TESTS']),
      ],
    };
  }

  async updateSettings(user: AuthUser, dto: UpdateLabSettingsDto) {
    const { lab, provider } = await this.myLab(user);
    this.access.assertCanManageProvider(user, provider.id);
    if (dto.homeCollectionHours && !validHours(dto.homeCollectionHours)) throw new BadRequestException('مواعيد السحب المنزلي غير صحيحة (وقت البداية يجب أن يسبق النهاية)');
    const patch: any = { ...dto };
    await this.ds.getRepository(Laboratory).update(lab.id, patch);
    if (dto.homeCollection !== undefined) {
      await this.ds.getRepository(Provider).update(provider.id, { homeServiceAvailable: dto.homeCollection });
    }
    await this.audit.log({ userId: user.id, action: 'LAB_SETTINGS_UPDATED', entity: 'laboratories', entityId: lab.id, oldValue: lab, newValue: dto });
    return this.mySettings(user);
  }

  async setBranchHours(user: AuthUser, branchId: string, hours: { day: number; open: number; close: number }[]) {
    const { provider } = await this.myLab(user);
    this.access.assertCanManageProvider(user, provider.id);
    if (!validHours(hours)) throw new BadRequestException('مواعيد العمل غير صحيحة (وقت البداية يجب أن يسبق النهاية)');
    const res = await this.ds.getRepository(ProviderBranch).update({ id: branchId, providerId: provider.id }, { openingHours: hours });
    if (!res.affected) throw new NotFoundException('الفرع غير موجود');
    await this.audit.log({ userId: user.id, action: 'BRANCH_HOURS_UPDATED', entity: 'provider_branches', entityId: branchId, newValue: hours });
    return { ok: true };
  }

  // ─────────────── Categories ───────────────

  async categories(labId: string) {
    return this.ds.getRepository(LabTestCategory).find({ where: { laboratoryId: labId }, order: { name: 'ASC' } });
  }

  async myCategories(user: AuthUser) {
    const { lab } = await this.myLab(user);
    return this.categories(lab.id);
  }

  async addCategory(user: AuthUser, dto: CategoryDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    return this.ds.getRepository(LabTestCategory).save({ laboratoryId: lab.id, name: dto.name.trim() });
  }

  async updateCategory(user: AuthUser, id: string, dto: CategoryDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    const res = await this.ds.getRepository(LabTestCategory).update({ id, laboratoryId: lab.id }, { name: dto.name.trim() });
    if (!res.affected) throw new NotFoundException('التصنيف غير موجود');
    return { ok: true };
  }

  async deleteCategory(user: AuthUser, id: string) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    const res = await this.ds.getRepository(LabTestCategory).delete({ id, laboratoryId: lab.id }); // tests keep existing (category → NULL)
    if (!res.affected) throw new NotFoundException('التصنيف غير موجود');
    return { deleted: true };
  }

  // ─────────────── Tests ───────────────

  private testsQuery(labId: string) {
    return this.ds
      .getRepository(LabTest)
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.category', 'c')
      .leftJoinAndSelect('t.parameters', 'prm')
      .leftJoinAndSelect('prm.ranges', 'r')
      .where('t.laboratoryId = :labId', { labId })
      .orderBy('t.name', 'ASC')
      .addOrderBy('prm.sortOrder', 'ASC')
      .addOrderBy('r.createdAt', 'ASC');
  }

  async myTests(user: AuthUser, q: CatalogTestsQuery) {
    const { lab } = await this.myLab(user);
    const qb = this.testsQuery(lab.id);
    if (q.search) qb.andWhere('(t.name ILIKE :s OR t.code ILIKE :s)', { s: `%${likeEscape(q.search)}%` });
    if (q.categoryId) qb.andWhere('t.categoryId = :cid', { cid: q.categoryId });
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(items, total, q);
  }

  private validateParams(params: ParameterDto[]) {
    if (!params.length) throw new BadRequestException('أضف بنداً واحداً على الأقل للتحليل (مثال: Hemoglobin)');
    const names = new Set<string>();
    for (const p of params) {
      const key = p.name.trim().toLowerCase();
      if (names.has(key)) throw new BadRequestException(`البند "${p.name}" مكرر`);
      names.add(key);
      for (const r of p.ranges ?? []) {
        if (r.low != null && r.high != null && r.low > r.high) throw new BadRequestException(`المدى الطبيعي للبند "${p.name}": الحد الأدنى أكبر من الأقصى`);
        if (r.criticalLow != null && r.criticalHigh != null && r.criticalLow >= r.criticalHigh) throw new BadRequestException(`الحدود الحرجة للبند "${p.name}" غير صحيحة`);
        if (r.ageMinYears != null && r.ageMaxYears != null && r.ageMinYears > r.ageMaxYears) throw new BadRequestException(`الفئة العمرية للبند "${p.name}" غير صحيحة`);
        if ((p.resultType ?? 'NUMERIC') === 'TEXT' && !r.textRange) throw new BadRequestException(`البند "${p.name}" نصي: اكتب القيمة الطبيعية (مثال: Negative)`);
      }
    }
  }

  private async assertCategory(m: EntityManager, labId: string, categoryId?: string | null) {
    if (!categoryId) return;
    if (!(await m.exists(LabTestCategory, { where: { id: categoryId, laboratoryId: labId } }))) throw new BadRequestException('التصنيف غير موجود');
  }

  private async writeParams(m: EntityManager, testId: string, params: ParameterDto[]) {
    const existing = await m.find(LabTestParameter, { where: { testId } });
    const keep = new Set(params.filter((p) => p.id).map((p) => p.id));
    const removed = existing.filter((e) => !keep.has(e.id));
    if (removed.length) {
      const used = await m.count(LabResultItem, { where: { parameterId: In(removed.map((r) => r.id)) } });
      if (used) throw new ConflictException('لا يمكن حذف بند له نتائج مسجلة. يمكنك تعديل اسمه أو إيقاف التحليل بالكامل.');
      await m.delete(LabTestParameter, { id: In(removed.map((r) => r.id)) });
    }
    let order = 0;
    for (const p of params) {
      const data = { name: p.name.trim(), unit: p.unit?.trim() || null, resultType: p.resultType ?? 'NUMERIC', sortOrder: order++ } as const;
      let id = p.id;
      if (id) {
        if (!existing.some((e) => e.id === id)) throw new BadRequestException('بند غير تابع لهذا التحليل');
        await m.update(LabTestParameter, id, data);
        await m.delete(LabTestRange, { parameterId: id });
      } else {
        id = (await m.save(m.create(LabTestParameter, { ...data, testId }))).id;
      }
      const ranges = (p.ranges ?? []).map((r) =>
        m.create(LabTestRange, {
          parameterId: id,
          gender: r.gender ?? null,
          ageMinYears: r.ageMinYears ?? null,
          ageMaxYears: r.ageMaxYears ?? null,
          low: r.low ?? null,
          high: r.high ?? null,
          criticalLow: r.criticalLow ?? null,
          criticalHigh: r.criticalHigh ?? null,
          textRange: r.textRange?.trim() || null,
        }),
      );
      if (ranges.length) await m.save(ranges);
    }
  }

  async createTest(user: AuthUser, dto: TestDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    this.validateParams(dto.parameters);
    const id = await this.ds.transaction(async (m) => {
      await this.assertCategory(m, lab.id, dto.categoryId);
      const code = dto.code.toUpperCase();
      if (await m.exists(LabTest, { where: { laboratoryId: lab.id, code } })) throw new ConflictException('يوجد تحليل بنفس الكود');
      const { parameters, ...rest } = dto;
      const t = await m.save(m.create(LabTest, { ...rest, code, laboratoryId: lab.id, categoryId: dto.categoryId ?? null }));
      await this.writeParams(m, t.id, parameters);
      await this.audit.log({ userId: user.id, action: 'LAB_TEST_CREATED', entity: 'lab_tests', entityId: t.id, newValue: { code, name: dto.name, price: dto.price } }, m);
      return t.id;
    });
    return this.getTest(lab.id, id);
  }

  async updateTest(user: AuthUser, id: string, dto: TestDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    this.validateParams(dto.parameters);
    await this.ds.transaction(async (m) => {
      const old = await m.findOne(LabTest, { where: { id, laboratoryId: lab.id } });
      if (!old) throw new NotFoundException('التحليل غير موجود');
      await this.assertCategory(m, lab.id, dto.categoryId);
      const code = dto.code.toUpperCase();
      if (code !== old.code && (await m.exists(LabTest, { where: { laboratoryId: lab.id, code } }))) throw new ConflictException('يوجد تحليل بنفس الكود');
      const { parameters, ...rest } = dto;
      await m.update(LabTest, id, { ...rest, code, categoryId: dto.categoryId ?? null });
      await this.writeParams(m, id, parameters);
      await this.audit.log({ userId: user.id, action: 'LAB_TEST_UPDATED', entity: 'lab_tests', entityId: id, oldValue: { code: old.code, name: old.name, price: old.price }, newValue: { code, name: dto.name, price: dto.price } }, m);
    });
    return this.getTest(lab.id, id);
  }

  async getTest(labId: string, id: string) {
    const t = await this.testsQuery(labId).andWhere('t.id = :id', { id }).getOne();
    if (!t) throw new NotFoundException('التحليل غير موجود');
    return t;
  }

  async myTest(user: AuthUser, id: string) {
    const { lab } = await this.myLab(user);
    return this.getTest(lab.id, id);
  }

  /** Tests referenced by orders or packages are deactivated instead of deleted, keeping history intact. */
  async deleteTest(user: AuthUser, id: string) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    const t = await this.ds.getRepository(LabTest).findOneBy({ id, laboratoryId: lab.id });
    if (!t) throw new NotFoundException('التحليل غير موجود');
    const used =
      (await this.ds.getRepository(LabOrderItem).exists({ where: { testId: id } })) ||
      (await this.ds.getRepository(LabPackageItem).exists({ where: { testId: id } }));
    if (used) {
      await this.ds.getRepository(LabTest).update(id, { isActive: false });
      await this.audit.log({ userId: user.id, action: 'LAB_TEST_DEACTIVATED', entity: 'lab_tests', entityId: id });
      return { deleted: false, deactivated: true };
    }
    await this.ds.getRepository(LabTest).delete(id);
    await this.audit.log({ userId: user.id, action: 'LAB_TEST_DELETED', entity: 'lab_tests', entityId: id, oldValue: { code: t.code, name: t.name } });
    return { deleted: true };
  }

  // ─────────────── Packages ───────────────

  private packagesQuery(labId: string) {
    return this.ds
      .getRepository(LabPackage)
      .createQueryBuilder('pk')
      .leftJoinAndSelect('pk.items', 'pi')
      .leftJoinAndSelect('pi.test', 't')
      .where('pk.laboratoryId = :labId', { labId })
      .orderBy('pk.createdAt', 'ASC');
  }

  async myPackages(user: AuthUser) {
    const { lab } = await this.myLab(user);
    return (await this.packagesQuery(lab.id).getMany()).map((p) => this.packageDto(p, true));
  }

  packageDto(p: LabPackage, full = false) {
    const tests = (p.items ?? []).map((i) => i.test!).filter(Boolean);
    const sumPrice = tests.reduce((s, t) => s + Number(t.price), 0);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      isActive: p.isActive,
      isVisible: p.isVisible,
      tests: tests.map((t) => ({ id: t.id, code: t.code, name: t.name, ...(full ? { price: t.price, isActive: t.isActive } : {}) })),
      separatePrice: sumPrice,
      savings: Math.max(0, Math.round((sumPrice - Number(p.price)) * 100) / 100),
    };
  }

  private async assertTests(m: EntityManager, labId: string, testIds: string[]) {
    const unique = [...new Set(testIds)];
    if (unique.length < 2) throw new BadRequestException('الباقة يجب أن تحتوي على تحليلين على الأقل');
    const found = await m.count(LabTest, { where: { id: In(unique), laboratoryId: labId } });
    if (found !== unique.length) throw new BadRequestException('بعض التحاليل المختارة غير موجودة في المعمل');
    return unique;
  }

  async createPackage(user: AuthUser, dto: PackageDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    const id = await this.ds.transaction(async (m) => {
      const testIds = await this.assertTests(m, lab.id, dto.testIds);
      const p = await m.save(m.create(LabPackage, { laboratoryId: lab.id, name: dto.name, description: dto.description ?? null, price: dto.price, isActive: dto.isActive ?? true }));
      await m.save(testIds.map((testId) => m.create(LabPackageItem, { packageId: p.id, testId })));
      await this.audit.log({ userId: user.id, action: 'LAB_PACKAGE_CREATED', entity: 'lab_packages', entityId: p.id, newValue: { name: dto.name, price: dto.price, testIds } }, m);
      return p.id;
    });
    return this.packageDto((await this.packagesQuery(lab.id).andWhere('pk.id = :id', { id }).getOne())!, true);
  }

  async updatePackage(user: AuthUser, id: string, dto: PackageDto) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    await this.ds.transaction(async (m) => {
      const old = await m.findOne(LabPackage, { where: { id, laboratoryId: lab.id } });
      if (!old) throw new NotFoundException('الباقة غير موجودة');
      const testIds = await this.assertTests(m, lab.id, dto.testIds);
      await m.update(LabPackage, id, { name: dto.name, description: dto.description ?? null, price: dto.price, isActive: dto.isActive ?? old.isActive });
      await m.delete(LabPackageItem, { packageId: id });
      await m.save(testIds.map((testId) => m.create(LabPackageItem, { packageId: id, testId })));
      await this.audit.log({ userId: user.id, action: 'LAB_PACKAGE_UPDATED', entity: 'lab_packages', entityId: id, oldValue: { name: old.name, price: old.price }, newValue: { name: dto.name, price: dto.price, testIds } }, m);
    });
    return this.packageDto((await this.packagesQuery(lab.id).andWhere('pk.id = :id', { id }).getOne())!, true);
  }

  async deletePackage(user: AuthUser, id: string) {
    const { lab, provider } = await this.myLab(user);
    this.assertManage(user, provider.id);
    const p = await this.ds.getRepository(LabPackage).findOneBy({ id, laboratoryId: lab.id });
    if (!p) throw new NotFoundException('الباقة غير موجودة');
    if (await this.ds.getRepository(LabOrderItem).exists({ where: { packageId: id } })) {
      await this.ds.getRepository(LabPackage).update(id, { isActive: false });
      return { deleted: false, deactivated: true };
    }
    await this.ds.getRepository(LabPackage).delete(id);
    await this.audit.log({ userId: user.id, action: 'LAB_PACKAGE_DELETED', entity: 'lab_packages', entityId: id, oldValue: { name: p.name } });
    return { deleted: true };
  }

  /** Platform moderation: hide a package from the public catalog. */
  async setPackageVisibility(user: AuthUser, id: string, isVisible: boolean) {
    const res = await this.ds.getRepository(LabPackage).update(id, { isVisible });
    if (!res.affected) throw new NotFoundException('الباقة غير موجودة');
    await this.audit.log({ userId: user.id, action: isVisible ? 'LAB_PACKAGE_SHOWN' : 'LAB_PACKAGE_HIDDEN', entity: 'lab_packages', entityId: id });
    return { ok: true };
  }

  async adminLabCatalog(providerId: string) {
    const lab = await this.ds.getRepository(Laboratory).findOne({ where: { providerId } });
    if (!lab) throw new NotFoundException('المعمل غير موجود');
    const [tests, packages] = await Promise.all([this.testsQuery(lab.id).getMany(), this.packagesQuery(lab.id).getMany()]);
    return { lab, tests, packages: packages.map((p) => this.packageDto(p, true)) };
  }

  // ─────────────── Public ───────────────

  async publicCatalog(key: string) {
    const lab = await this.publicLab(key);
    const [tests, packages, categories, branches] = await Promise.all([
      this.ds
        .getRepository(LabTest)
        .createQueryBuilder('t')
        .leftJoinAndSelect('t.parameters', 'prm')
        .where('t.laboratoryId = :id AND t.isActive = true', { id: lab.id })
        .orderBy('t.name', 'ASC')
        .addOrderBy('prm.sortOrder', 'ASC')
        .getMany(),
      this.packagesQuery(lab.id).andWhere('pk.isActive = true AND pk.isVisible = true').getMany(),
      this.categories(lab.id),
      this.ds.getRepository(ProviderBranch).find({ where: { providerId: lab.providerId, isActive: true }, relations: { city: true, area: true }, order: { createdAt: 'ASC' } }),
    ]);
    const p = lab.provider!;
    return {
      laboratory: {
        id: lab.id,
        homeCollection: lab.homeCollection && !!lab.homeCollectionHours?.length,
        homeCollectionFee: lab.homeCollectionFee ?? 0,
        accreditation: lab.accreditation,
        slotMinutes: lab.slotMinutes,
        bookingHorizonDays: lab.bookingHorizonDays,
      },
      provider: { id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, logoFileId: p.logoFileId, phone: p.phone, whatsappNumber: p.whatsappNumber, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, description: p.description },
      categories,
      branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone, city: b.city?.nameAr, area: b.area?.nameAr, openingHours: b.openingHours, bookable: !!b.openingHours?.length })),
      tests: tests.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        description: t.description,
        price: t.price,
        categoryId: t.categoryId,
        sampleType: t.sampleType,
        preparationInstructions: t.preparationInstructions,
        turnaroundHours: t.turnaroundHours,
        parameters: (t.parameters ?? []).map((x) => x.name),
      })),
      packages: packages.filter((pk) => pk.items?.every((i) => i.test?.isActive)).map((pk) => this.packageDto(pk)),
    };
  }

  /**
   * Cross-lab price comparison. Labs define their own catalogs; offers are grouped
   * by the test code (case-insensitive) so "CBC" at every lab lands in one row.
   */
  async searchTests(q: SearchTestsQuery) {
    const params: unknown[] = [];
    const where: string[] = [`t.is_active`, `p.verification_status = 'APPROVED'`, `p.is_active`, `p.subscription_active`, `o.status = 'ACTIVE'`];
    if (q.search) {
      params.push(`%${likeEscape(q.search)}%`);
      where.push(`(t.name ILIKE $${params.length} OR t.code ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
    }
    const loc: string[] = [];
    if (q.areaId) (params.push(q.areaId), loc.push(`xb.area_id = $${params.length}`));
    else if (q.cityId) (params.push(q.cityId), loc.push(`xb.city_id = $${params.length}`));
    else if (q.governorateId) (params.push(q.governorateId), loc.push(`xc.governorate_id = $${params.length}`));
    if (loc.length) {
      where.push(`EXISTS (SELECT 1 FROM provider_branches xb LEFT JOIN cities xc ON xc.id = xb.city_id
                    WHERE xb.provider_id = p.id AND xb.is_active AND ${loc.join(' AND ')})`);
    }
    const from = `FROM lab_tests t JOIN laboratories l ON l.id = t.laboratory_id JOIN providers p ON p.id = l.provider_id JOIN users o ON o.id = p.owner_user_id`;
    const cond = `WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(DISTINCT upper(t.code))::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const groups: { code: string }[] = await this.ds.query(
      `SELECT upper(t.code) AS code, count(*) AS n, min(t.price) AS mn ${from} ${cond}
        GROUP BY upper(t.code) ORDER BY count(*) DESC, upper(t.code) LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    if (!groups.length) return paginate([], total, q);
    const codes = groups.map((g) => g.code);
    const offers = await this.ds.query(
      `SELECT upper(t.code) AS code, t.id AS test_id, t.name, t.price::float AS price, t.sample_type, t.preparation_instructions,
              t.turnaround_hours, l.id AS laboratory_id, l.home_collection AND l.home_collection_hours IS NOT NULL AS home_collection,
              p.id AS provider_id, p.slug, p.name_ar, p.rating_avg::float AS rating_avg, p.logo_file_id
         ${from} ${cond} AND upper(t.code) = ANY($${params.length + 1}::text[])
        ORDER BY t.price ASC`,
      [...params, codes],
    );
    const items = codes.map((code) => {
      const list = offers.filter((o: any) => o.code === code);
      return {
        code,
        name: list[0]?.name,
        minPrice: Math.min(...list.map((o: any) => o.price)),
        maxPrice: Math.max(...list.map((o: any) => o.price)),
        offers: list.map((o: any) => ({
          testId: o.test_id,
          laboratoryId: o.laboratory_id,
          providerId: o.provider_id,
          slug: o.slug,
          labName: o.name_ar,
          logoFileId: o.logo_file_id,
          ratingAvg: o.rating_avg,
          name: o.name,
          price: o.price,
          sampleType: o.sample_type,
          preparationInstructions: o.preparation_instructions,
          turnaroundHours: o.turnaround_hours,
          homeCollection: o.home_collection,
        })),
      };
    });
    return paginate(items, total, q);
  }
}
