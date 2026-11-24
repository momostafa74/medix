import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { FileEntity, FileVisibility, Medicine, Prescription, PrescriptionItem } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { humanCode, secureToken } from '../../common/utils/codes';
import { normalizePhone } from '../../common/utils/phone';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../files/storage';
import { PdfService } from '../pdf/pdf.service';
import { ageInYears } from '../labs/lab-logic';
import { RX_STATE_AR, RxState, medicineLabel, prescriptionState } from '../pharmacy/pharmacy-logic';
import { prescriptionHtml } from './prescription.template';
import { CreatePrescriptionDto, PrescriptionsQuery, RxLookupDto } from './prescriptions.dto';

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

export type RxViewer = 'PATIENT' | 'AUTHOR' | 'CARE_TEAM' | 'PHARMACY';

const ACTIVE_APPT = ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];


@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);
  readonly tz: string;
  private readonly frontendUrl: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private access: AccessPolicyService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private storage: StorageService,
    private pdf: PdfService,
  ) {
    this.tz = config.get<string>('timezone')!;
    this.frontendUrl = config.get<string>('frontendUrl')!;
  }

  state(rx: Pick<Prescription, 'revokedAt' | 'dispensedAt' | 'validUntil'>): RxState {
    return prescriptionState(rx, new Date(), this.tz);
  }

  today() {
    return DateTime.now().setZone(this.tz).toISODate()!;
  }

  // ─────────────── Writing ───────────────

  async create(user: AuthUser, dto: CreatePrescriptionDto, meta: Meta = {}) {
    if (!user.doctorId || !user.permissions.has(P.PRESCRIPTIONS_WRITE)) throw new ForbiddenException('كتابة الروشتات متاحة للأطباء فقط');
    const [doc] = await this.ds.query(`SELECT d.provider_id, p.is_active, p.verification_status FROM doctors d JOIN providers p ON p.id = d.provider_id WHERE d.id = $1`, [user.doctorId]);
    if (!doc) throw new ForbiddenException('ملف الطبيب غير موجود');
    if (!(await this.access.providerHasPatientRelationship([doc.provider_id], dto.patientId))) {
      throw new ForbiddenException('يمكنك كتابة روشتة لمريض لديه حجز معك أو منحك صلاحية الاطلاع على ملفه فقط');
    }
    const validDays = dto.validDays ?? (await this.settings.get<number>('prescriptions.defaultValidityDays'));

    const rx = await this.ds.transaction(async (m) => {
      const [patient] = await m.query(`SELECT pa.id, pa.user_id, u.status FROM patients pa JOIN users u ON u.id = pa.user_id WHERE pa.id = $1`, [dto.patientId]);
      if (!patient) throw new NotFoundException('المريض غير موجود');
      if (patient.user_id === user.id) throw new BadRequestException('لا يمكنك كتابة روشتة لنفسك');
      if (dto.appointmentId) {
        const [a] = await m.query(`SELECT status FROM appointments WHERE id = $1 AND doctor_id = $2 AND patient_id = $3`, [dto.appointmentId, user.doctorId, dto.patientId]);
        if (!a) throw new BadRequestException('الحجز المرتبط غير صحيح');
        if (!ACTIVE_APPT.includes(a.status)) throw new BadRequestException('لا يمكن ربط الروشتة بحجز ملغي أو لم يتم');
      }
      const ids = dto.items.map((i) => i.medicineId).filter(Boolean) as string[];
      const meds = ids.length ? await m.find(Medicine, { where: { id: In(ids) } }) : [];
      const byId = new Map(meds.map((x) => [x.id, x]));
      const items = dto.items.map((i, idx) => {
        let name = i.medicineName?.trim();
        if (i.medicineId) {
          const med = byId.get(i.medicineId);
          if (!med || !med.isActive) throw new BadRequestException(`الدواء رقم ${idx + 1} غير موجود في الدليل`);
          name = medicineLabel(med);
        }
        if (!name) throw new BadRequestException(`اكتب اسم الدواء رقم ${idx + 1}`);
        return {
          medicineId: i.medicineId ?? null,
          medicineName: name,
          dose: i.dose.trim(),
          frequency: i.frequency.trim(),
          duration: i.duration.trim(),
          quantity: i.quantity ?? null,
          instructions: i.instructions?.trim() || null,
          sortOrder: idx,
        };
      });
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dupes.length) throw new BadRequestException('الدواء مكرر في الروشتة');

      const saved = await m.save(
        m.create(Prescription, {
          code: humanCode('RX'),
          verificationCode: secureToken(12),
          doctorId: user.doctorId!,
          patientId: dto.patientId,
          appointmentId: dto.appointmentId ?? null,
          diagnosis: dto.diagnosis?.trim() || null,
          notes: dto.notes?.trim() || null,
          validUntil: DateTime.now().setZone(this.tz).plus({ days: validDays }).toISODate()!,
          items: items.map((i) => m.create(PrescriptionItem, i)),
        }),
      );
      await this.audit.log(
        { userId: user.id, action: 'PRESCRIPTION_CREATED', entity: 'prescriptions', entityId: saved.id, newValue: { code: saved.code, patientId: dto.patientId, items: items.length }, ...meta },
        m,
      );
      return { saved, patientUserId: patient.user_id as string };
    });
    await this.notifications.notify(rx.patientUserId, {
      type: 'PRESCRIPTION_ISSUED',
      category: 'PRESCRIPTIONS',
      title: 'روشتة جديدة',
      body: `كتب لك ${user.fullName} روشتة إلكترونية (${rx.saved.code}). يمكنك عرضها أو طلبها من صيدلية.`,
      data: { prescriptionId: rx.saved.id },
    });
    return this.get(user, rx.saved.id);
  }

  async revoke(user: AuthUser, id: string, reason: string, meta: Meta = {}) {
    const rx = await this.ds.transaction(async (m) => {
      const rx = await m.findOne(Prescription, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rx) throw new NotFoundException('الروشتة غير موجودة');
      if (rx.doctorId !== user.doctorId) throw new ForbiddenException('يمكن للطبيب الذي كتب الروشتة فقط إلغاؤها');
      const st = this.state(rx);
      if (st === 'DISPENSED') throw new ConflictException('تم صرف الروشتة بالفعل ولا يمكن إلغاؤها');
      if (st === 'REVOKED') throw new ConflictException('الروشتة ملغاة بالفعل');
      await m.update(Prescription, id, { revokedAt: new Date(), revokeReason: reason.trim(), pdfFileId: null });
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_REVOKED', entity: 'prescriptions', entityId: id, newValue: { reason }, ...meta }, m);
      return rx;
    });
    const [p] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [rx.patientId]);
    if (p) {
      await this.notifications.notify(p.user_id, {
        type: 'PRESCRIPTION_REVOKED',
        category: 'PRESCRIPTIONS',
        title: 'تم إلغاء روشتة',
        body: `ألغى الطبيب الروشتة ${rx.code}. السبب: ${reason}`,
        data: { prescriptionId: id },
        force: true,
      });
    }
    // Pharmacies holding an open order for it must stop.
    const open: { order_id: string; provider_id: string; code: string }[] = await this.ds.query(
      `SELECT o.id AS order_id, ph.provider_id, o.code FROM pharmacy_orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id
        WHERE o.prescription_id = $1 AND o.status NOT IN ('DELIVERED','CANCELLED')`,
      [id],
    );
    for (const o of open) {
      const team: { id: string }[] = await this.ds.query(
        `SELECT owner_user_id AS id FROM providers WHERE id = $1 UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active`,
        [o.provider_id],
      );
      await this.notifications.notifyMany(
        team.map((t) => t.id),
        { type: 'PRESCRIPTION_REVOKED', category: 'PHARMACY', title: 'روشتة طلب تم إلغاؤها', body: `ألغى الطبيب الروشتة المرتبطة بالطلب ${o.code}. لا تصرف الأدوية المقررة بها.`, data: { pharmacyOrderId: o.order_id }, force: true },
      );
    }
    return this.get(user, id);
  }

  // ─────────────── Reading ───────────────

  async load(id: string, m: EntityManager = this.ds.manager) {
    const rx = await m.findOne(Prescription, {
      where: { id },
      relations: { items: true, doctor: { user: true, provider: true }, patient: { user: true } },
      order: { items: { sortOrder: 'ASC' } },
    });
    if (!rx) throw new NotFoundException('الروشتة غير موجودة');
    return rx;
  }

  /** Pharmacy ids (pharmacies.id) the user works at. */
  async myPharmacyIds(user: AuthUser, m: EntityManager = this.ds.manager): Promise<string[]> {
    if (!user.providerIds.length) return [];
    const rows: { id: string }[] = await m.query(`SELECT id FROM pharmacies WHERE provider_id = ANY($1::uuid[])`, [user.providerIds]);
    return rows.map((r) => r.id);
  }

  async viewerFor(user: AuthUser, rx: { id: string; patientId: string; doctorId: string }): Promise<RxViewer> {
    if (user.patientId && rx.patientId === user.patientId) return 'PATIENT';
    if (user.doctorId && rx.doctorId === user.doctorId) return 'AUTHOR';
    if (user.permissions.has(P.PRESCRIPTIONS_VERIFY) || user.permissions.has(P.PHARMACY_ORDERS_MANAGE)) {
      const ph = await this.myPharmacyIds(user);
      if (ph.length) {
        // A pharmacy sees a prescription only once the patient sent it with an order, or it dispensed it.
        const [row] = await this.ds.query(
          `SELECT 1 FROM pharmacy_orders WHERE prescription_id = $1 AND pharmacy_id = ANY($2::uuid[])
           UNION SELECT 1 FROM prescriptions p JOIN pharmacies ph ON ph.provider_id = p.dispensed_by_provider_id WHERE p.id = $1 AND ph.id = ANY($2::uuid[]) LIMIT 1`,
          [rx.id, ph],
        );
        if (row) return 'PHARMACY';
      }
    }
    try {
      await this.access.assertCanReadMedicalRecord(user, rx.patientId);
      return 'CARE_TEAM';
    } catch {
      throw new NotFoundException('الروشتة غير موجودة');
    }
  }

  private async dispensedBy(rx: Prescription) {
    if (!rx.dispensedByProviderId) return null;
    const [p] = await this.ds.query(`SELECT name_ar, slug FROM providers WHERE id = $1`, [rx.dispensedByProviderId]);
    return p ? { nameAr: p.name_ar, slug: p.slug } : null;
  }

  async doctorInfo(doctorId: string) {
    const [d] = await this.ds.query(
      `SELECT d.id, d.provider_id, d.title, d.license_number, u.full_name, pr.name_ar AS clinic, pr.slug, pr.phone,
              (SELECT s.name_ar FROM doctor_specialties ds JOIN specialties s ON s.id = ds.specialty_id WHERE ds.doctor_id = d.id ORDER BY ds.is_primary DESC LIMIT 1) AS specialty,
              (SELECT b.address FROM provider_branches b WHERE b.provider_id = pr.id AND b.is_active ORDER BY b.created_at LIMIT 1) AS address
         FROM doctors d JOIN users u ON u.id = d.user_id JOIN providers pr ON pr.id = d.provider_id WHERE d.id = $1`,
      [doctorId],
    );
    return d;
  }

  serialize(rx: Prescription, extra: Record<string, unknown> = {}) {
    const st = this.state(rx);
    return {
      id: rx.id,
      code: rx.code,
      issuedAt: rx.issuedAt,
      validUntil: rx.validUntil,
      diagnosis: rx.diagnosis,
      notes: rx.notes,
      state: st,
      stateLabel: RX_STATE_AR[st],
      revokedAt: rx.revokedAt,
      revokeReason: rx.revokeReason,
      dispensedAt: rx.dispensedAt,
      items: (rx.items ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({ id: i.id, medicineId: i.medicineId, medicineName: i.medicineName, dose: i.dose, frequency: i.frequency, duration: i.duration, quantity: i.quantity, instructions: i.instructions })),
      ...extra,
    };
  }

  async get(user: AuthUser, id: string, meta: Meta = {}) {
    const rx = await this.load(id);
    const viewer = await this.viewerFor(user, rx);
    const st = this.state(rx);
    const d = await this.doctorInfo(rx.doctorId);
    const pa = rx.patient!;
    if (viewer === 'CARE_TEAM' || viewer === 'PHARMACY') {
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_VIEWED', entity: 'prescriptions', entityId: id, newValue: { by: viewer }, ...meta });
    }
    const orders =
      viewer === 'PATIENT' || viewer === 'AUTHOR'
        ? await this.ds.query(
            `SELECT o.id, o.code, o.status, o.created_at, pr.name_ar AS pharmacy_name FROM pharmacy_orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id JOIN providers pr ON pr.id = ph.provider_id
              WHERE o.prescription_id = $1 ${viewer === 'AUTHOR' ? "AND o.status = 'DELIVERED'" : ''} ORDER BY o.created_at DESC`,
            [id],
          )
        : [];
    return this.serialize(rx, {
      viewer,
      verificationCode: viewer === 'PATIENT' || viewer === 'AUTHOR' ? rx.verificationCode : undefined,
      appointmentId: rx.appointmentId,
      doctor: { id: d.id, providerId: d.provider_id, fullName: d.full_name, title: d.title, specialty: d.specialty, clinic: d.clinic, slug: d.slug, licenseNumber: d.license_number },
      patient: { id: pa.id, fullName: pa.user?.fullName, gender: pa.gender, ageYears: ageInYears(pa.dateOfBirth, rx.issuedAt) },
      dispensedBy: await this.dispensedBy(rx),
      orders: orders.map((o: any) => ({ id: o.id, code: o.code, status: o.status, createdAt: o.created_at, pharmacyName: o.pharmacy_name })),
      can: {
        revoke: viewer === 'AUTHOR' && (st === 'ACTIVE' || st === 'EXPIRED'),
        order: viewer === 'PATIENT' && st === 'ACTIVE',
        pdf: true,
      },
    });
  }

  async list(user: AuthUser, scope: 'patient' | 'doctor', q: PrescriptionsQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (scope === 'patient') {
      if (!user.patientId) return paginate([], 0, q);
      add('p.patient_id = ?', user.patientId);
    } else {
      if (!user.doctorId) throw new ForbiddenException('هذا الحساب ليس حساب طبيب');
      add('p.doctor_id = ?', user.doctorId);
      if (q.patientId) add('p.patient_id = ?', q.patientId);
    }
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      add(`(p.code ILIKE ? OR p.diagnosis ILIKE ? OR ${scope === 'patient' ? 'du.full_name' : 'pu.full_name'} ILIKE ? OR EXISTS (SELECT 1 FROM prescription_items i WHERE i.prescription_id = p.id AND i.medicine_name ILIKE ?))`, s);
    }
    const from = `FROM prescriptions p JOIN doctors d ON d.id = p.doctor_id JOIN users du ON du.id = d.user_id
                  JOIN patients pa ON pa.id = p.patient_id JOIN users pu ON pu.id = pa.user_id`;
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT p.id, p.code, p.issued_at, to_char(p.valid_until, 'YYYY-MM-DD') AS valid_until, p.diagnosis, p.revoked_at, p.dispensed_at, du.full_name AS doctor_name, pu.full_name AS patient_name, pa.id AS patient_id,
              (SELECT json_agg(i.medicine_name ORDER BY i.sort_order) FROM prescription_items i WHERE i.prescription_id = p.id) AS medicines
         ${from} ${cond} ORDER BY p.issued_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => {
        const st = this.state({ revokedAt: r.revoked_at, dispensedAt: r.dispensed_at, validUntil: r.valid_until });
        return {
          id: r.id,
          code: r.code,
          issuedAt: r.issued_at,
          validUntil: r.valid_until,
          diagnosis: r.diagnosis,
          state: st,
          stateLabel: RX_STATE_AR[st],
          doctorName: r.doctor_name,
          patientName: r.patient_name,
          patientId: r.patient_id,
          medicines: r.medicines ?? [],
        };
      }),
      total,
      q,
    );
  }

  /** Prescriptions in a patient's medical record — the patient, or providers with a care relationship. */
  async patientHistory(user: AuthUser, patientId: string, meta: Meta = {}) {
    await this.access.assertCanReadMedicalRecord(user, patientId);
    const list = await this.ds.getRepository(Prescription).find({
      where: { patientId },
      relations: { items: true },
      order: { issuedAt: 'DESC' },
      take: 50,
    });
    const doctors = await this.ds.query(
      `SELECT d.id, u.full_name, pr.slug FROM doctors d JOIN users u ON u.id = d.user_id JOIN providers pr ON pr.id = d.provider_id WHERE d.id = ANY($1::uuid[])`,
      [[...new Set(list.map((r) => r.doctorId))]],
    );
    const byId = new Map(doctors.map((d: any) => [d.id, d]));
    if (user.patientId !== patientId) {
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTIONS_VIEWED_BY_PROVIDER', entity: 'patients', entityId: patientId, newValue: { count: list.length }, ...meta });
    }
    return list.map((rx) => {
      const d: any = byId.get(rx.doctorId);
      return this.serialize(rx, { doctor: { id: rx.doctorId, fullName: d?.full_name, slug: d?.slug }, mine: rx.doctorId === user.doctorId });
    });
  }

  // ─────────────── Pharmacy: lookup & dispensing ───────────────

  /**
   * The QR verification code opens the prescription directly. The printed number
   * (RX-…) is short enough to be guessed, so it also needs the patient's phone.
   */
  private async findByCode(m: EntityManager, dto: RxLookupDto) {
    const code = dto.code.trim();
    const byQr = await m.findOne(Prescription, { where: { verificationCode: code } });
    if (byQr) return byQr;
    const rx = await m.findOne(Prescription, { where: { code: code.toUpperCase() } });
    if (!rx) return null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (!phone) throw new BadRequestException({ message: 'أدخل رقم موبايل المريض للتحقق من الروشتة برقمها', code: 'PHONE_REQUIRED' });
    const [u] = await m.query(`SELECT u.phone FROM patients pa JOIN users u ON u.id = pa.user_id WHERE pa.id = $1`, [rx.patientId]);
    return u?.phone === phone ? rx : null;
  }

  async pharmacyLookup(user: AuthUser, dto: RxLookupDto, meta: Meta = {}) {
    const ph = await this.myPharmacyIds(user);
    if (!ph.length) throw new ForbiddenException('هذا الحساب غير مرتبط بصيدلية');
    const found = await this.findByCode(this.ds.manager, dto);
    if (!found) {
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_LOOKUP_FAILED', entity: 'prescriptions', newValue: { code: dto.code.slice(0, 20) }, ...meta });
      throw new NotFoundException('لا توجد روشتة بهذا الرقم أو البيانات غير متطابقة');
    }
    const rx = await this.load(found.id);
    const st = this.state(rx);
    const d = await this.doctorInfo(rx.doctorId);
    const pa = rx.patient!;
    const medIds = (rx.items ?? []).map((i) => i.medicineId).filter(Boolean) as string[];
    const stock = medIds.length
      ? await this.ds.query(`SELECT medicine_id, price::float AS price, in_stock, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = ANY($2::uuid[])`, [ph[0], medIds])
      : [];
    const sMap = new Map(stock.map((s: any) => [s.medicine_id, s]));
    await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_VIEWED_BY_PHARMACY', entity: 'prescriptions', entityId: rx.id, newValue: { state: st }, ...meta });
    const out = this.serialize(rx, {
      viewer: 'PHARMACY',
      doctor: { id: d.id, fullName: d.full_name, specialty: d.specialty, clinic: d.clinic, licenseNumber: d.license_number, phone: d.phone },
      patient: { fullName: pa.user?.fullName, gender: pa.gender, ageYears: ageInYears(pa.dateOfBirth, rx.issuedAt) },
      dispensedBy: await this.dispensedBy(rx),
      can: { dispense: st === 'ACTIVE' && user.permissions.has(P.PRESCRIPTIONS_VERIFY) },
    });
    return {
      ...out,
      items: out.items.map((i) => {
        const s: any = i.medicineId ? sMap.get(i.medicineId) : null;
        return { ...i, stock: s ? { price: s.price, inStock: s.in_stock && (s.quantity == null || s.quantity > 0), quantity: s.quantity } : null };
      }),
    };
  }

  /**
   * Marks a prescription dispensed. The conditional UPDATE is the guard: two pharmacies
   * (or two counters) racing on the same prescription — only one row update can win.
   */
  async markDispensed(m: EntityManager, rxId: string, by: { providerId: string; userId: string; orderId?: string | null }) {
    const res = await m.query(
      `UPDATE prescriptions SET dispensed_at = now(), dispensed_by_provider_id = $2, dispensed_by_id = $3, dispensed_order_id = $4, pdf_file_id = NULL
        WHERE id = $1 AND dispensed_at IS NULL AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until >= $5::date)`,
      [rxId, by.providerId, by.userId, by.orderId ?? null, this.today()],
    );
    return (res?.[1] ?? 0) > 0;
  }

  async dispense(user: AuthUser, dto: RxLookupDto & { orderId?: string }, meta: Meta = {}) {
    const ph = await this.myPharmacyIds(user);
    if (!ph.length) throw new ForbiddenException('هذا الحساب غير مرتبط بصيدلية');
    const { rx, providerId } = await this.ds.transaction(async (m) => {
      const rx = await this.findByCode(m, dto);
      if (!rx) throw new NotFoundException('لا توجد روشتة بهذا الرقم أو البيانات غير متطابقة');
      const [pharm] = await m.query(`SELECT provider_id FROM pharmacies WHERE id = $1`, [ph[0]]);
      if (dto.orderId) {
        const [o] = await m.query(`SELECT id, pharmacy_id, patient_id, prescription_id FROM pharmacy_orders WHERE id = $1`, [dto.orderId]);
        if (!o || !ph.includes(o.pharmacy_id) || o.patient_id !== rx.patientId) throw new BadRequestException('الطلب غير مرتبط بهذه الروشتة');
        if (o.prescription_id && o.prescription_id !== rx.id) throw new BadRequestException('الطلب مرتبط بروشتة أخرى');
      }
      const st = this.state(rx);
      if (st !== 'ACTIVE') throw new ConflictException({ message: `لا يمكن صرف الروشتة: ${RX_STATE_AR[st]}`, code: `RX_${st}` });
      if (!(await this.markDispensed(m, rx.id, { providerId: pharm.provider_id, userId: user.id, orderId: dto.orderId }))) {
        throw new ConflictException({ message: 'تم صرف هذه الروشتة للتو من مكان آخر', code: 'RX_DISPENSED' });
      }
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_DISPENSED', entity: 'prescriptions', entityId: rx.id, newValue: { pharmacyProviderId: pharm.provider_id, orderId: dto.orderId ?? null }, ...meta }, m);
      return { rx, providerId: pharm.provider_id as string };
    });
    await this.notifyDispensed(rx, providerId);
    return this.pharmacyLookup(user, { code: rx.verificationCode }, meta);
  }

  async notifyDispensed(rx: { id: string; code: string; patientId: string }, providerId: string) {
    const [row] = await this.ds.query(`SELECT pa.user_id, pr.name_ar FROM patients pa, providers pr WHERE pa.id = $1 AND pr.id = $2`, [rx.patientId, providerId]);
    if (row) {
      await this.notifications.notify(row.user_id, {
        type: 'PRESCRIPTION_DISPENSED',
        category: 'PRESCRIPTIONS',
        title: 'تم صرف الروشتة',
        body: `صرفت ${row.name_ar} الروشتة ${rx.code}.`,
        data: { prescriptionId: rx.id },
      });
    }
  }

  // ─────────────── Public verification ───────────────

  /** QR landing — authenticity and status only; never the medicines or the diagnosis. */
  async verify(code: string) {
    const rx = await this.ds.getRepository(Prescription).findOne({ where: { verificationCode: code } });
    if (!rx) return null;
    const [row] = await this.ds.query(
      `SELECT u.full_name AS doctor_name, pr.name_ar, pr.slug, pu.full_name AS patient_name
         FROM doctors d JOIN users u ON u.id = d.user_id JOIN providers pr ON pr.id = d.provider_id, patients pa JOIN users pu ON pu.id = pa.user_id
        WHERE d.id = $1 AND pa.id = $2`,
      [rx.doctorId, rx.patientId],
    );
    const st = this.state(rx);
    const initials = String(row?.patient_name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => `${w.charAt(0)}.`).join(' ');
    return {
      valid: true,
      type: 'PRESCRIPTION',
      documentNumber: rx.code,
      issuer: { name: row?.doctor_name, clinic: row?.name_ar, slug: row?.slug },
      approvedAt: rx.issuedAt,
      validUntil: rx.validUntil,
      patientInitials: initials,
      state: st,
      stateLabel: RX_STATE_AR[st],
      dispensedAt: rx.dispensedAt,
    };
  }

  // ─────────────── PDF ───────────────

  private async readAll(key: string): Promise<Buffer> {
    const stream = await this.storage.driver.get(key);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private async render(rx: Prescription) {
    const d = await this.doctorInfo(rx.doctorId);
    const st = this.state(rx);
    const date = (v: string | Date) => DateTime.fromJSDate(new Date(v)).setZone(this.tz).setLocale('ar-EG').toFormat('d LLLL yyyy');
    const html = prescriptionHtml({
      fontCss: this.pdf.fonts(),
      platformName: await this.settings.get<string>('platform.name'),
      doctor: {
        name: `${d.title ? `${d.title} ` : 'د. '}${d.full_name}`.replace(/^د\. د\. /, 'د. '),
        specialty: d.specialty,
        license: d.license_number,
        clinic: d.clinic && !String(d.clinic).includes(d.full_name) ? d.clinic : null,
        address: d.address,
        phone: d.phone,
      },
      patient: { name: rx.patient?.user?.fullName ?? '', age: ageInYears(rx.patient?.dateOfBirth, rx.issuedAt), gender: rx.patient?.gender },
      rx: { code: rx.code, issuedAt: date(rx.issuedAt), validUntil: rx.validUntil ? date(rx.validUntil) : null, diagnosis: rx.diagnosis, notes: rx.notes, state: st, stateLabel: RX_STATE_AR[st] },
      items: (rx.items ?? []).map((i) => ({ name: i.medicineName, dose: i.dose, frequency: i.frequency, duration: i.duration, quantity: i.quantity, instructions: i.instructions })),
      qrDataUrl: await this.pdf.qrDataUrl(`${this.frontendUrl.replace(/\/$/, '')}/verify/${rx.verificationCode}`),
      verificationCode: rx.verificationCode,
    });
    return this.pdf.render(html, { format: 'A5' });
  }

  /** Active prescriptions are cached as a private file; any state change clears the cache (void watermark). */
  async pdfFor(user: AuthUser, id: string, meta: Meta = {}) {
    const rx = await this.load(id);
    const viewer = await this.viewerFor(user, rx);
    const fileName = `prescription-${rx.code}.pdf`;
    await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_PDF_DOWNLOADED', entity: 'prescriptions', entityId: id, newValue: { by: viewer }, ...meta });
    const active = this.state(rx) === 'ACTIVE';
    if (active && rx.pdfFileId) {
      const f = await this.ds.getRepository(FileEntity).findOneBy({ id: rx.pdfFileId });
      if (f) {
        try {
          return { buffer: await this.readAll(f.storageKey), fileName };
        } catch {
          /* regenerate */
        }
      }
    }
    const buffer = await this.render(rx);
    if (active) {
      try {
        const key = `private/prescription/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
        await this.storage.driver.put(key, buffer, 'application/pdf');
        const repo = this.ds.getRepository(FileEntity);
        const file = await repo.save(
          repo.create({
            storageKey: key,
            driver: this.storage.driver.name,
            originalName: fileName,
            mimeType: 'application/pdf',
            size: buffer.length,
            checksum: createHash('sha256').update(buffer).digest('hex'),
            visibility: FileVisibility.PRIVATE,
            purpose: 'PRESCRIPTION',
            uploadedById: rx.doctor?.userId,
          }),
        );
        await this.ds.query(`UPDATE prescriptions SET pdf_file_id = $2 WHERE id = $1 AND dispensed_at IS NULL AND revoked_at IS NULL`, [rx.id, file.id]);
      } catch (e: any) {
        this.logger.warn(`Prescription PDF cache failed: ${e.message}`);
      }
    }
    return { buffer, fileName };
  }

  async canReadFile(user: AuthUser, fileId: string) {
    const rx = await this.ds.getRepository(Prescription).findOne({ where: { pdfFileId: fileId } });
    if (!rx) return false;
    try {
      await this.viewerFor(user, rx);
      return true;
    } catch {
      return false;
    }
  }
}
