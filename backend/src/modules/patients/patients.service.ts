import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import {
  Allergy,
  Appointment,
  FileEntity,
  MedicalCondition,
  MedicalDocument,
  MedicalRecord,
  Medication,
  Patient,
  PatientAccessGrant,
  Provider,
  Surgery,
  VerificationStatus,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, PaginationQueryDto, paginate, skipTake } from '../../common/dto/pagination.dto';
import { normalizePhone } from '../../common/utils/phone';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { AddMedicalDocumentDto, AllergyDto, ConditionDto, GrantAccessDto, MedicationDto, SurgeryDto, UpdatePatientDto } from './patients.dto';

const SECTIONS = {
  allergies: { entity: Allergy, dto: AllergyDto },
  conditions: { entity: MedicalCondition, dto: ConditionDto },
  medications: { entity: Medication, dto: MedicationDto },
  surgeries: { entity: Surgery, dto: SurgeryDto },
} as const;
export type Section = keyof typeof SECTIONS;

type Meta = { ip?: string; userAgent?: string | null };

@Injectable()
export class PatientsService {
  constructor(
    private ds: DataSource,
    private access: AccessPolicyService,
    private audit: AuditService,
  ) {}

  private ownPatientId(user: AuthUser) {
    if (!user.patientId) throw new ForbiddenException('هذا الحساب ليس حساب مريض');
    return user.patientId;
  }

  // ─────────────── Own profile ───────────────

  async me(user: AuthUser) {
    return this.ds.getRepository(Patient).findOne({
      where: { id: this.ownPatientId(user) },
      relations: { user: true, city: true, area: true },
    });
  }

  async updateMe(user: AuthUser, dto: UpdatePatientDto) {
    const id = this.ownPatientId(user);
    const patch: any = { ...dto };
    if (dto.emergencyContactPhone) {
      patch.emergencyContactPhone = normalizePhone(dto.emergencyContactPhone);
      if (!patch.emergencyContactPhone) throw new BadRequestException('رقم هاتف الطوارئ غير صحيح');
    }
    await this.ds.getRepository(Patient).update(id, patch);
    return this.me(user);
  }

  // ─────────────── Medical record ───────────────

  private async recordFor(patientId: string) {
    const repo = this.ds.getRepository(MedicalRecord);
    let r = await repo.findOneBy({ patientId });
    if (!r) r = await repo.save(repo.create({ patientId }));
    return r;
  }

  private async fullRecord(patientId: string) {
    const r = await this.recordFor(patientId);
    const full = await this.ds.getRepository(MedicalRecord).findOne({
      where: { id: r.id },
      relations: { allergies: true, conditions: true, medications: true, surgeries: true },
    });
    const patient = await this.ds.getRepository(Patient).findOne({ where: { id: patientId }, relations: { user: true } });
    const documents = await this.ds.getRepository(MedicalDocument).find({
      where: { patientId },
      relations: { file: true },
      order: { createdAt: 'DESC' },
    });
    const visits = await this.ds.getRepository(Appointment).find({
      where: { patientId, status: 'COMPLETED' as any },
      relations: { provider: true, specialty: true },
      order: { startAt: 'DESC' },
      take: 50,
    });
    return {
      patient: {
        id: patient!.id,
        fullName: patient!.user?.fullName,
        dateOfBirth: patient!.dateOfBirth,
        gender: patient!.gender,
        bloodType: patient!.bloodType,
      },
      record: full,
      documents: documents.map((d) => ({
        id: d.id,
        type: d.type,
        title: d.title,
        documentDate: d.documentDate,
        createdAt: d.createdAt,
        file: d.file ? { id: d.file.id, mimeType: d.file.mimeType, size: d.file.size, originalName: d.file.originalName } : null,
      })),
      visits: visits.map((v) => ({ id: v.id, code: v.code, startAt: v.startAt, provider: v.provider?.nameAr, specialty: v.specialty?.nameAr })),
    };
  }

  myRecord(user: AuthUser) {
    return this.fullRecord(this.ownPatientId(user));
  }

  async setRecordNotes(user: AuthUser, notes: string) {
    const r = await this.recordFor(this.ownPatientId(user));
    await this.ds.getRepository(MedicalRecord).update(r.id, { notes });
    return this.myRecord(user);
  }

  private section(name: string) {
    const s = (SECTIONS as any)[name];
    if (!s) throw new NotFoundException('قسم غير معروف');
    return s as (typeof SECTIONS)[Section];
  }

  private async validated(dtoClass: any, body: unknown, partial = false) {
    const inst = plainToInstance(dtoClass, body ?? {});
    const errors = await validate(inst as object, { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: partial });
    if (errors.length) {
      throw new BadRequestException({ message: 'البيانات المرسلة غير صحيحة', details: errors.flatMap((e) => Object.values(e.constraints ?? {})) });
    }
    return inst as Record<string, unknown>;
  }

  async addItem(user: AuthUser, section: string, body: unknown) {
    const s = this.section(section);
    const data = await this.validated(s.dto, body);
    const r = await this.recordFor(this.ownPatientId(user));
    const repo = this.ds.getRepository(s.entity as any);
    const saved = await repo.save(repo.create({ ...data, medicalRecordId: r.id }));
    await this.audit.log({ userId: user.id, action: 'MEDICAL_RECORD_UPDATED', entity: 'medical_records', entityId: r.id, newValue: { section, op: 'add' } });
    return saved;
  }

  async updateItem(user: AuthUser, section: string, id: string, body: unknown) {
    const s = this.section(section);
    const data = await this.validated(s.dto, body, true);
    const r = await this.recordFor(this.ownPatientId(user));
    // Scoped by medicalRecordId — another patient's item id matches nothing.
    const res = await this.ds.getRepository(s.entity as any).update({ id, medicalRecordId: r.id }, data);
    if (!res.affected) throw new NotFoundException('العنصر غير موجود');
    return this.ds.getRepository(s.entity as any).findOneBy({ id });
  }

  async deleteItem(user: AuthUser, section: string, id: string) {
    const s = this.section(section);
    const r = await this.recordFor(this.ownPatientId(user));
    const res = await this.ds.getRepository(s.entity as any).delete({ id, medicalRecordId: r.id });
    if (!res.affected) throw new NotFoundException('العنصر غير موجود');
    return { deleted: true };
  }

  // ─────────────── Documents ───────────────

  async addDocument(user: AuthUser, dto: AddMedicalDocumentDto) {
    const patientId = this.ownPatientId(user);
    const f = await this.ds.getRepository(FileEntity).findOneBy({ id: dto.fileId, uploadedById: user.id });
    if (!f || !['MEDICAL_DOCUMENT', 'REFERRAL'].includes(f.purpose)) throw new BadRequestException('الملف غير صالح');
    const exists = await this.ds.getRepository(MedicalDocument).exists({ where: { fileId: f.id } });
    if (exists) throw new BadRequestException('هذا الملف مضاف بالفعل');
    return this.ds.getRepository(MedicalDocument).save({
      patientId,
      fileId: f.id,
      type: dto.type,
      title: dto.title,
      documentDate: dto.documentDate?.slice(0, 10) ?? null,
    });
  }

  async deleteDocument(user: AuthUser, id: string) {
    const patientId = this.ownPatientId(user);
    const doc = await this.ds.getRepository(MedicalDocument).findOneBy({ id, patientId });
    if (!doc) throw new NotFoundException('المستند غير موجود');
    await this.ds.getRepository(MedicalDocument).delete(id);
    return { deleted: true };
  }

  // ─────────────── Consent grants ───────────────

  async listGrants(user: AuthUser) {
    return this.ds.getRepository(PatientAccessGrant).find({
      where: { patientId: this.ownPatientId(user), revokedAt: IsNull() },
      relations: { provider: true },
      order: { grantedAt: 'DESC' },
    });
  }

  async grant(user: AuthUser, dto: GrantAccessDto) {
    const patientId = this.ownPatientId(user);
    const provider = await this.ds.getRepository(Provider).findOneBy({ id: dto.providerId, verificationStatus: VerificationStatus.APPROVED });
    if (!provider) throw new NotFoundException('مقدم الخدمة غير موجود');
    const g = await this.ds.getRepository(PatientAccessGrant).save({
      patientId,
      providerId: provider.id,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    await this.audit.log({ userId: user.id, action: 'MEDICAL_ACCESS_GRANTED', entity: 'patients', entityId: patientId, newValue: { providerId: provider.id } });
    return g;
  }

  async revokeGrant(user: AuthUser, id: string) {
    const patientId = this.ownPatientId(user);
    const res = await this.ds.getRepository(PatientAccessGrant).update({ id, patientId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!res.affected) throw new NotFoundException('غير موجود');
    await this.audit.log({ userId: user.id, action: 'MEDICAL_ACCESS_REVOKED', entity: 'patients', entityId: patientId, newValue: { grantId: id } });
    return { ok: true };
  }

  // ─────────────── Provider / admin views ───────────────

  /** Doctor/provider: only patients who booked with them. Admin/support: everyone. */
  async list(user: AuthUser, q: PaginationQueryDto) {
    const params: unknown[] = [];
    let scope = '';
    const all = user.permissions.has(P.PATIENTS_READ_ANY);
    if (!all) {
      if (!user.providerIds.length) throw new ForbiddenException('غير مصرح');
      params.push(user.providerIds);
      scope = `AND a.provider_id = ANY($1::uuid[])`;
    }
    let search = '';
    if (q.search) {
      params.push(`%${likeEscape(q.search)}%`);
      search = `AND (u.full_name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`;
    }
    const { skip, take } = skipTake(q);
    const base = all
      ? `FROM patients p JOIN users u ON u.id = p.user_id
         LEFT JOIN appointments a ON a.patient_id = p.id
         WHERE 1=1 ${search}`
      : `FROM patients p JOIN users u ON u.id = p.user_id
         JOIN appointments a ON a.patient_id = p.id ${scope}
         WHERE a.status <> 'CANCELLED' ${search}`;
    const rows = await this.ds.query(
      `SELECT p.id, u.full_name AS "fullName", u.phone, p.gender, p.date_of_birth AS "dateOfBirth",
              count(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS "completedVisits",
              count(a.id)::int AS "totalAppointments",
              max(a.start_at) FILTER (WHERE a.start_at < now()) AS "lastVisit",
              min(a.start_at) FILTER (WHERE a.start_at >= now() AND a.status IN ('PENDING','CONFIRMED')) AS "nextVisit"
         ${base}
        GROUP BY p.id, u.full_name, u.phone
        ORDER BY max(a.start_at) DESC NULLS LAST
        OFFSET ${skip} LIMIT ${take}`,
      params,
    );
    const [{ total }] = await this.ds.query(`SELECT count(DISTINCT p.id)::int AS total ${base}`, params);
    return paginate(rows, total, q);
  }

  async getForProvider(user: AuthUser, patientId: string, meta: Meta) {
    await this.access.assertCanReadPatientProfile(user, patientId);
    const p = await this.ds.getRepository(Patient).findOne({ where: { id: patientId }, relations: { user: true, city: true, area: true } });
    if (!p) throw new NotFoundException('المريض غير موجود');
    await this.audit.log({ userId: user.id, action: 'PATIENT_PROFILE_VIEWED', entity: 'patients', entityId: patientId, ...meta });
    const apptScope = user.permissions.has(P.APPOINTMENTS_READ_ANY) ? '' : `AND a.provider_id = ANY($2::uuid[])`;
    const appts = await this.ds.query(
      `SELECT a.id, a.code, a.start_at AS "startAt", a.status, a.type, a.final_price AS "finalPrice", a.notes,
              ${user.permissions.has(P.APPOINTMENTS_READ_ANY) ? 'NULL' : 'a.doctor_notes'} AS "doctorNotes", pr.name_ar AS "providerName"
         FROM appointments a JOIN providers pr ON pr.id = a.provider_id
        WHERE a.patient_id = $1 ${apptScope}
        ORDER BY a.start_at DESC LIMIT 100`,
      apptScope ? [patientId, user.providerIds] : [patientId],
    );
    const canSeeMedical = await this.access
      .assertCanReadMedicalRecord(user, patientId)
      .then(() => true)
      .catch(() => false);
    return {
      id: p.id,
      fullName: p.user?.fullName,
      phone: p.user?.phone,
      email: p.user?.email,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      bloodType: canSeeMedical ? p.bloodType : undefined,
      address: p.address,
      city: p.city?.nameAr,
      area: p.area?.nameAr,
      appointments: appts,
      canSeeMedicalRecord: canSeeMedical,
    };
  }

  async medicalRecordForProvider(user: AuthUser, patientId: string, meta: Meta) {
    await this.access.assertCanReadMedicalRecord(user, patientId);
    // Sensitive access is always audited.
    await this.audit.log({ userId: user.id, action: 'MEDICAL_RECORD_VIEWED', entity: 'medical_records', entityId: patientId, ...meta });
    return this.fullRecord(patientId);
  }
}
