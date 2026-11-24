import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In } from 'typeorm';
import { Medicine, Pharmacy, PharmacyInventory, ProviderBranch, VerificationStatus } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { validHours } from '../labs/lab-logic';
import { isOpenAt, medicineKey } from './pharmacy-logic';
import {
  AdminMedicineDto,
  AdminMedicinesQuery,
  InventoryItemDto,
  InventoryQuery,
  MedicineDto,
  MedicineSearchQuery,
  NewMedicineInventoryDto,
  PublicCatalogQuery,
  UpdateInventoryDto,
  UpdatePharmacySettingsDto,
} from './pharmacy.dto';

/** Pharmacies patients can order from: approved, active, owner active. */
export const LIVE_PHARMACIES = `SELECT ph.id FROM pharmacies ph JOIN providers p ON p.id = ph.provider_id JOIN users ow ON ow.id = p.owner_user_id
  WHERE p.verification_status = 'APPROVED' AND p.is_active AND p.subscription_active AND ow.status = 'ACTIVE'`;

const medDto = (m: any) => ({
  id: m.id,
  nameEn: m.name_en ?? m.nameEn,
  nameAr: m.name_ar ?? m.nameAr,
  genericName: m.generic_name ?? m.genericName,
  form: m.form,
  strength: m.strength,
  manufacturer: m.manufacturer,
  requiresPrescription: m.requires_prescription ?? m.requiresPrescription,
  kind: m.kind,
  category: m.category,
  barcode: m.barcode,
});

@Injectable()
export class PharmacyCatalogService {
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private access: AccessPolicyService,
    private audit: AuditService,
  ) {
    this.tz = config.get<string>('timezone')!;
  }

  async myPharmacy(user: AuthUser, m: EntityManager = this.ds.manager) {
    if (!user.providerIds.length) throw new ForbiddenException('هذا الحساب غير مرتبط بصيدلية');
    const pharmacy = await m.findOne(Pharmacy, { where: { providerId: In(user.providerIds) }, relations: { provider: true } });
    if (!pharmacy) throw new ForbiddenException('هذا الحساب غير مرتبط بصيدلية');
    return { pharmacy, provider: pharmacy.provider! };
  }

  /** Public lookup by provider id / pharmacy id / slug. */
  async publicPharmacy(key: string, m: EntityManager = this.ds.manager) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const ph = await m
      .getRepository(Pharmacy)
      .createQueryBuilder('ph')
      .innerJoinAndSelect('ph.provider', 'p')
      .innerJoin('p.owner', 'o', "o.status = 'ACTIVE'")
      .where(isUuid ? '(p.id = :k OR ph.id = :k)' : 'p.slug = :k', { k: key })
      .andWhere('p.verificationStatus = :st AND p.isActive = true AND p.subscriptionActive = true', { st: VerificationStatus.APPROVED })
      .getOne();
    if (!ph) throw new NotFoundException('الصيدلية غير موجودة أو غير متاحة حالياً');
    return ph;
  }

  // ─────────────── Medicines (shared catalog) ───────────────

  async searchMedicines(q: MedicineSearchQuery) {
    const where: string[] = ['m.is_active'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    params.push(q.cityId ?? null);
    const offerJoin = `LEFT JOIN pharmacy_inventory pi ON pi.medicine_id = m.id AND pi.in_stock AND (pi.quantity IS NULL OR pi.quantity > 0)
      AND pi.pharmacy_id IN (${LIVE_PHARMACIES}
        AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM provider_branches b WHERE b.provider_id = p.id AND b.is_active AND b.city_id = $1::uuid)))`;
    let rank = 'm.name_en';
    if (q.search?.trim()) {
      const s = q.search.trim();
      params.push(s);
      const n = params.length;
      where.push(
        `(m.name_en ILIKE $${n + 1} OR m.name_ar ILIKE $${n + 1} OR m.generic_name ILIKE $${n + 1} OR m.barcode = $${n} OR m.name_en % $${n} OR coalesce(m.name_ar, '') % $${n})`,
      );
      params.push(`%${likeEscape(s)}%`);
      rank = `greatest(similarity(m.name_en, $${n}), similarity(coalesce(m.name_ar, ''), $${n}), similarity(coalesce(m.generic_name, ''), $${n})) DESC, m.name_en`;
    }
    if (q.kind) add('m.kind = ?', q.kind);
    if (q.category) add('m.category = ?', q.category);
    if (q.requiresPrescription !== undefined) add('m.requires_prescription = ?', q.requiresPrescription);
    const having = q.available ? 'HAVING count(pi.id) > 0' : '';
    const base = `FROM medicines m ${offerJoin} WHERE ${where.join(' AND ')} GROUP BY m.id ${having}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (SELECT m.id ${base}) x`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT m.*, count(pi.id)::int AS offers, min(pi.price)::float AS min_price, max(pi.price)::float AS max_price
         ${base} ORDER BY ${q.search?.trim() ? '' : 'count(pi.id) DESC, '}${rank} LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({ ...medDto(r), offers: r.offers, minPrice: r.min_price, maxPrice: r.max_price })),
      total,
      q,
    );
  }

  async categories() {
    const rows = await this.ds.query(`SELECT kind, category, count(*)::int AS count FROM medicines WHERE is_active AND category IS NOT NULL GROUP BY kind, category ORDER BY kind, count(*) DESC`);
    return rows;
  }

  /** One medicine with every pharmacy offering it (cheapest first) and same-ingredient alternatives. */
  async medicineOffers(id: string, cityId?: string) {
    const med = await this.ds.getRepository(Medicine).findOne({ where: { id, isActive: true } });
    if (!med) throw new NotFoundException('الدواء غير موجود');
    const offers = await this.ds.query(
      `SELECT pi.price::float AS price, pi.quantity, ph.id AS pharmacy_id, ph.delivery_available, ph.delivery_fee::float AS delivery_fee, ph.free_delivery_over::float AS free_delivery_over,
              ph.min_order_for_delivery::float AS min_order_for_delivery, ph.estimated_delivery_minutes, ph.is24_hours,
              p.id AS provider_id, p.name_ar, p.slug, p.logo_file_id, p.rating_avg::float AS rating_avg, p.rating_count,
              (SELECT json_build_object('city', c.name_ar, 'area', a.name_ar, 'address', b.address, 'hours', b.opening_hours)
                 FROM provider_branches b LEFT JOIN cities c ON c.id = b.city_id LEFT JOIN areas a ON a.id = b.area_id
                WHERE b.provider_id = p.id AND b.is_active AND ($2::uuid IS NULL OR b.city_id = $2::uuid) ORDER BY b.created_at LIMIT 1) AS branch
         FROM pharmacy_inventory pi JOIN pharmacies ph ON ph.id = pi.pharmacy_id JOIN providers p ON p.id = ph.provider_id
        WHERE pi.medicine_id = $1 AND pi.in_stock AND (pi.quantity IS NULL OR pi.quantity > 0) AND ph.id IN (${LIVE_PHARMACIES})
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM provider_branches b WHERE b.provider_id = p.id AND b.is_active AND b.city_id = $2::uuid))
        ORDER BY pi.price ASC, p.rating_avg DESC LIMIT 50`,
      [id, cityId ?? null],
    );
    const alternatives = med.genericName
      ? await this.ds.query(
          `SELECT m.*, (SELECT min(pi.price)::float FROM pharmacy_inventory pi WHERE pi.medicine_id = m.id AND pi.in_stock AND pi.pharmacy_id IN (${LIVE_PHARMACIES})) AS min_price
             FROM medicines m WHERE m.is_active AND m.id <> $1 AND lower(m.generic_name) = lower($2) ORDER BY m.name_en LIMIT 10`,
          [id, med.genericName],
        )
      : [];
    const now = new Date();
    return {
      medicine: medDto(med),
      offers: offers.map((o: any) => ({
        price: o.price,
        lowStock: o.quantity != null && o.quantity <= 5,
        pharmacy: {
          id: o.pharmacy_id,
          providerId: o.provider_id,
          nameAr: o.name_ar,
          slug: o.slug,
          logoFileId: o.logo_file_id,
          ratingAvg: o.rating_avg,
          ratingCount: o.rating_count,
          deliveryAvailable: o.delivery_available,
          deliveryFee: o.delivery_fee,
          freeDeliveryOver: o.free_delivery_over,
          minOrderForDelivery: o.min_order_for_delivery,
          estimatedDeliveryMinutes: o.estimated_delivery_minutes,
          is24Hours: o.is24_hours,
          city: o.branch?.city,
          area: o.branch?.area,
          address: o.branch?.address,
          openNow: isOpenAt(o.branch?.hours, now, this.tz, o.is24_hours),
        },
      })),
      alternatives: alternatives.map((a: any) => ({ ...medDto(a), minPrice: a.min_price })),
    };
  }

  // ─────────────── Public pharmacy profile & catalog ───────────────

  async publicProfile(key: string) {
    const ph = await this.publicPharmacy(key);
    const p = ph.provider!;
    const branches = await this.ds.getRepository(ProviderBranch).find({ where: { providerId: p.id, isActive: true }, relations: { city: true, area: true }, order: { createdAt: 'ASC' } });
    const [counts] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE m.kind = 'MEDICINE')::int AS medicines, count(*) FILTER (WHERE m.kind = 'PRODUCT')::int AS products
         FROM pharmacy_inventory pi JOIN medicines m ON m.id = pi.medicine_id WHERE pi.pharmacy_id = $1 AND pi.in_stock AND m.is_active`,
      [ph.id],
    );
    const categories = await this.ds.query(
      `SELECT m.kind, m.category, count(*)::int AS count FROM pharmacy_inventory pi JOIN medicines m ON m.id = pi.medicine_id
        WHERE pi.pharmacy_id = $1 AND pi.in_stock AND m.is_active AND m.category IS NOT NULL GROUP BY m.kind, m.category ORDER BY count(*) DESC`,
      [ph.id],
    );
    const now = new Date();
    return {
      pharmacy: {
        id: ph.id,
        deliveryAvailable: ph.deliveryAvailable,
        deliveryFee: ph.deliveryFee ?? 0,
        freeDeliveryOver: ph.freeDeliveryOver,
        minOrderForDelivery: ph.minOrderForDelivery,
        estimatedDeliveryMinutes: ph.estimatedDeliveryMinutes,
        deliveryAreasNote: ph.deliveryAreasNote,
        is24Hours: ph.is24Hours,
        openNow: ph.is24Hours || branches.some((b) => isOpenAt(b.openingHours, now, this.tz)),
      },
      provider: { id: p.id, slug: p.slug, nameAr: p.nameAr, nameEn: p.nameEn, logoFileId: p.logoFileId, phone: p.phone, whatsappNumber: p.whatsappNumber, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount, description: p.description },
      branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone, city: b.city?.nameAr, area: b.area?.nameAr, openingHours: b.openingHours, openNow: isOpenAt(b.openingHours, now, this.tz, ph.is24Hours) })),
      counts,
      categories,
    };
  }

  async publicItems(key: string, q: PublicCatalogQuery) {
    const ph = await this.publicPharmacy(key);
    return this.inventoryQuery(ph.id, q, true);
  }

  private async inventoryQuery(pharmacyId: string, q: InventoryQuery | PublicCatalogQuery, publicView: boolean) {
    const where: string[] = ['pi.pharmacy_id = $1'];
    const params: unknown[] = [pharmacyId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (publicView) where.push('pi.in_stock AND (pi.quantity IS NULL OR pi.quantity > 0) AND m.is_active');
    if (q.search?.trim()) {
      const s = `%${likeEscape(q.search.trim())}%`;
      add('(m.name_en ILIKE ? OR m.name_ar ILIKE ? OR m.generic_name ILIKE ? OR m.barcode ILIKE ?)', s);
    }
    if (q.kind) add('m.kind = ?', q.kind);
    if (q.category) add('m.category = ?', q.category);
    const stock = (q as InventoryQuery).stock;
    if (!publicView && stock === 'in') where.push('pi.in_stock AND (pi.quantity IS NULL OR pi.quantity > 0)');
    if (!publicView && stock === 'out') where.push('(NOT pi.in_stock OR pi.quantity = 0)');
    if (!publicView && stock === 'low') where.push('pi.quantity IS NOT NULL AND pi.quantity <= 5');
    const from = `FROM pharmacy_inventory pi JOIN medicines m ON m.id = pi.medicine_id WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT m.*, pi.id AS inventory_id, pi.price::float AS price, pi.in_stock, pi.quantity, pi.updated_at AS inv_updated_at ${from}
        ORDER BY m.kind, m.name_en LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.inventory_id,
        price: r.price,
        inStock: r.in_stock && (r.quantity == null || r.quantity > 0),
        quantity: publicView ? undefined : r.quantity,
        lowStock: r.quantity != null && r.quantity <= 5,
        updatedAt: publicView ? undefined : r.inv_updated_at,
        medicine: { ...medDto(r), isActive: publicView ? undefined : r.is_active },
      })),
      total,
      q,
    );
  }

  // ─────────────── Pharmacy workspace ───────────────

  async mySettings(user: AuthUser) {
    const { pharmacy, provider } = await this.myPharmacy(user);
    const branches = await this.ds.getRepository(ProviderBranch).find({ where: { providerId: provider.id }, order: { createdAt: 'ASC' } });
    const [counts] = await this.ds.query(
      `SELECT count(*)::int AS items, count(*) FILTER (WHERE in_stock AND (quantity IS NULL OR quantity > 0))::int AS in_stock,
              count(*) FILTER (WHERE quantity IS NOT NULL AND quantity <= 5)::int AS low_stock
         FROM pharmacy_inventory WHERE pharmacy_id = $1`,
      [pharmacy.id],
    );
    const { provider: _p, ...rest } = pharmacy;
    return {
      ...rest,
      provider: { id: provider.id, nameAr: provider.nameAr, slug: provider.slug, verificationStatus: provider.verificationStatus, type: provider.type },
      branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, isActive: b.isActive, openingHours: b.openingHours })),
      counts: { items: counts.items, inStock: counts.in_stock, lowStock: counts.low_stock },
      setupWarnings: [
        ...(pharmacy.is24Hours || branches.some((b) => b.isActive && b.openingHours?.length) ? [] : ['BRANCH_HOURS_MISSING']),
        ...(counts.items ? [] : ['NO_INVENTORY']),
        ...(pharmacy.deliveryAvailable && pharmacy.deliveryFee == null ? ['DELIVERY_FEE_MISSING'] : []),
      ],
    };
  }

  async updateSettings(user: AuthUser, dto: UpdatePharmacySettingsDto) {
    const { pharmacy, provider } = await this.myPharmacy(user);
    this.access.assertCanManageProvider(user, provider.id);
    await this.ds.getRepository(Pharmacy).update(pharmacy.id, { ...dto } as any);
    if (dto.deliveryAvailable !== undefined) await this.ds.query(`UPDATE providers SET home_service_available = $2 WHERE id = $1`, [provider.id, dto.deliveryAvailable]);
    const { provider: _p, ...old } = pharmacy;
    await this.audit.log({ userId: user.id, action: 'PHARMACY_SETTINGS_UPDATED', entity: 'pharmacies', entityId: pharmacy.id, oldValue: old, newValue: dto });
    return this.mySettings(user);
  }

  async setBranchHours(user: AuthUser, branchId: string, hours: { day: number; open: number; close: number }[]) {
    const { provider } = await this.myPharmacy(user);
    this.access.assertCanManageProvider(user, provider.id);
    if (!validHours(hours)) throw new BadRequestException('مواعيد العمل غير صحيحة (وقت البداية يجب أن يسبق النهاية)');
    const res = await this.ds.getRepository(ProviderBranch).update({ id: branchId, providerId: provider.id }, { openingHours: hours });
    if (!res.affected) throw new NotFoundException('الفرع غير موجود');
    await this.audit.log({ userId: user.id, action: 'BRANCH_HOURS_UPDATED', entity: 'provider_branches', entityId: branchId, newValue: hours });
    return { ok: true };
  }

  async myInventory(user: AuthUser, q: InventoryQuery) {
    const { pharmacy } = await this.myPharmacy(user);
    return this.inventoryQuery(pharmacy.id, q, false);
  }

  private assertCatalog(user: AuthUser) {
    if (!user.permissions.has(P.PHARMACY_CATALOG_MANAGE)) throw new ForbiddenException('لا تملك صلاحية تعديل أصناف الصيدلية');
  }

  async addInventory(user: AuthUser, dto: InventoryItemDto) {
    this.assertCatalog(user);
    const { pharmacy } = await this.myPharmacy(user);
    const med = await this.ds.getRepository(Medicine).findOne({ where: { id: dto.medicineId, isActive: true } });
    if (!med) throw new BadRequestException('الصنف غير موجود في الدليل');
    const exists = await this.ds.getRepository(PharmacyInventory).findOne({ where: { pharmacyId: pharmacy.id, medicineId: med.id } });
    if (exists) throw new ConflictException({ message: 'الصنف موجود بالفعل في قائمة صيدليتك — عدّل سعره من القائمة', code: 'ALREADY_LISTED', id: exists.id });
    const row = await this.ds.getRepository(PharmacyInventory).save({
      pharmacyId: pharmacy.id,
      medicineId: med.id,
      price: dto.price,
      quantity: dto.quantity ?? null,
      inStock: dto.inStock ?? (dto.quantity == null || dto.quantity > 0),
    });
    await this.audit.log({ userId: user.id, action: 'PHARMACY_INVENTORY_ADDED', entity: 'pharmacy_inventory', entityId: row.id, newValue: { medicineId: med.id, price: dto.price, quantity: dto.quantity } });
    return { id: row.id };
  }

  /** Pharmacies may add missing items to the shared catalog; identical name+strength+form is reused, not duplicated. */
  async addNewMedicine(user: AuthUser, dto: NewMedicineInventoryDto) {
    this.assertCatalog(user);
    const { pharmacy, provider } = await this.myPharmacy(user);
    const { price, quantity, ...m } = dto;
    const key = medicineKey(m);
    m.nameEn = m.nameEn.trim().replace(/\s+/g, ' ');
    const candidates = await this.ds.query(`SELECT id, name_en, strength, form, is_active FROM medicines WHERE lower(regexp_replace(name_en, '\\s+', '', 'g')) = lower($1)`, [m.nameEn.replace(/\s/g, '')]);
    let med = candidates.find((c: any) => medicineKey({ nameEn: c.name_en, strength: c.strength, form: c.form }) === key);
    let created = false;
    if (med && !med.is_active) throw new BadRequestException('هذا الصنف موقوف من إدارة المنصة');
    if (!med) {
      const saved = await this.ds.getRepository(Medicine).save({
        ...this.cleanMedicine(m),
        kind: m.kind ?? 'MEDICINE',
        requiresPrescription: !!m.requiresPrescription,
        createdByProviderId: provider.id,
        isActive: true,
      } as Partial<Medicine>);
      med = { id: saved.id };
      created = true;
      await this.audit.log({ userId: user.id, action: 'MEDICINE_ADDED_BY_PHARMACY', entity: 'medicines', entityId: saved.id, newValue: m });
    }
    const inv = await this.addInventory(user, { medicineId: med.id, price, quantity });
    return { ...inv, medicineId: med.id, createdMedicine: created, pharmacyId: pharmacy.id };
  }

  async updateInventory(user: AuthUser, id: string, dto: UpdateInventoryDto) {
    if (!user.permissions.has(P.PHARMACY_CATALOG_MANAGE) && !user.permissions.has(P.PHARMACY_ORDERS_MANAGE)) throw new ForbiddenException('لا تملك صلاحية تعديل المخزون');
    // Staff may update stock; prices are for catalog managers.
    if (dto.price !== undefined && !user.permissions.has(P.PHARMACY_CATALOG_MANAGE)) throw new ForbiddenException('تعديل الأسعار متاح لمدير الصيدلية فقط');
    const { pharmacy } = await this.myPharmacy(user);
    const row = await this.ds.getRepository(PharmacyInventory).findOne({ where: { id, pharmacyId: pharmacy.id } });
    if (!row) throw new NotFoundException('الصنف غير موجود');
    const patch: Record<string, any> = {};
    if (dto.price !== undefined) patch.price = dto.price;
    if (dto.quantity !== undefined) patch.quantity = dto.quantity;
    if (dto.inStock !== undefined) patch.inStock = dto.inStock;
    else if (dto.quantity !== undefined && dto.quantity !== null) patch.inStock = dto.quantity > 0;
    await this.ds.getRepository(PharmacyInventory).update(id, patch);
    await this.audit.log({ userId: user.id, action: 'PHARMACY_INVENTORY_UPDATED', entity: 'pharmacy_inventory', entityId: id, oldValue: { price: row.price, quantity: row.quantity, inStock: row.inStock }, newValue: patch });
    return { ok: true };
  }

  async removeInventory(user: AuthUser, id: string) {
    this.assertCatalog(user);
    const { pharmacy } = await this.myPharmacy(user);
    const res = await this.ds.getRepository(PharmacyInventory).delete({ id, pharmacyId: pharmacy.id });
    if (!res.affected) throw new NotFoundException('الصنف غير موجود');
    await this.audit.log({ userId: user.id, action: 'PHARMACY_INVENTORY_REMOVED', entity: 'pharmacy_inventory', entityId: id });
    return { ok: true };
  }

  // ─────────────── Platform administration ───────────────

  private cleanMedicine(m: MedicineDto) {
    const t = (v?: string | null) => (v == null ? v : v.trim() || null);
    return {
      nameEn: m.nameEn.trim().replace(/\s+/g, ' '),
      nameAr: t(m.nameAr),
      genericName: t(m.genericName),
      form: t(m.form),
      strength: t(m.strength),
      manufacturer: t(m.manufacturer),
      category: t(m.category),
      barcode: t(m.barcode),
      ...(m.kind ? { kind: m.kind } : {}),
      ...(m.requiresPrescription !== undefined ? { requiresPrescription: m.requiresPrescription } : {}),
    };
  }

  async adminList(q: AdminMedicinesQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (q.search?.trim()) add('(m.name_en ILIKE ? OR m.name_ar ILIKE ? OR m.generic_name ILIKE ? OR m.barcode ILIKE ?)', `%${likeEscape(q.search.trim())}%`);
    if (q.kind) add('m.kind = ?', q.kind);
    if (q.category) add('m.category = ?', q.category);
    if (q.isActive !== undefined) add('m.is_active = ?', q.isActive);
    if (q.requiresPrescription !== undefined) add('m.requires_prescription = ?', q.requiresPrescription);
    if (q.pharmacyAdded) where.push('m.created_by_provider_id IS NOT NULL');
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM medicines m ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT m.*, pr.name_ar AS added_by,
              (SELECT count(*) FROM pharmacy_inventory pi WHERE pi.medicine_id = m.id)::int AS pharmacies,
              (SELECT count(*) FROM pharmacy_order_items oi WHERE oi.medicine_id = m.id)::int AS ordered
         FROM medicines m LEFT JOIN providers pr ON pr.id = m.created_by_provider_id ${cond}
        ORDER BY m.created_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({ ...medDto(r), isActive: r.is_active, addedBy: r.added_by, pharmacies: r.pharmacies, ordered: r.ordered, createdAt: r.created_at })),
      total,
      q,
    );
  }

  async adminCreate(user: AuthUser, dto: AdminMedicineDto) {
    const saved = await this.ds.getRepository(Medicine).save({ ...this.cleanMedicine(dto), isActive: dto.isActive ?? true } as Partial<Medicine>);
    await this.audit.log({ userId: user.id, action: 'MEDICINE_CREATED', entity: 'medicines', entityId: saved.id, newValue: dto });
    return medDto(saved);
  }

  async adminUpdate(user: AuthUser, id: string, dto: Partial<AdminMedicineDto>) {
    const med = await this.ds.getRepository(Medicine).findOneBy({ id });
    if (!med) throw new NotFoundException('الصنف غير موجود');
    const patch: Record<string, unknown> = dto.nameEn ? this.cleanMedicine(dto as MedicineDto) : {};
    if (!dto.nameEn) {
      for (const k of ['nameAr', 'genericName', 'form', 'strength', 'manufacturer', 'category', 'barcode', 'kind', 'requiresPrescription'] as const) {
        if (dto[k] !== undefined) patch[k] = dto[k];
      }
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    await this.ds.getRepository(Medicine).update(id, patch);
    await this.audit.log({ userId: user.id, action: 'MEDICINE_UPDATED', entity: 'medicines', entityId: id, oldValue: med, newValue: patch });
    return { ok: true };
  }
}
