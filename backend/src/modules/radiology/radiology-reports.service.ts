import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import {
  FileEntity,
  FileVisibility,
  RadiologyOrder,
  RadiologyOrderStatus as S,
  RadiologyReport,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { secureToken } from '../../common/utils/codes';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { JobQueueService } from '../../common/jobs/job-queue.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../files/storage';
import { PdfService } from '../pdf/pdf.service';
import { ageInYears } from '../labs/lab-logic';
import { reportFooter } from '../labs/lab-report.template';
import { RadiologyOrdersService } from './radiology-orders.service';
import { RadiologyCatalogService } from './radiology-catalog.service';
import { radiologyReportHtml } from './radiology-report.template';
import { MODALITIES, RELEASED } from './radiology-logic';
import { SaveReportDto } from './radiology.dto';

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

@Injectable()
export class RadiologyReportsService implements OnModuleInit {
  private readonly logger = new Logger(RadiologyReportsService.name);
  private readonly frontendUrl: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private orders: RadiologyOrdersService,
    private catalog: RadiologyCatalogService,
    private access: AccessPolicyService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private jobs: JobQueueService,
    private storage: StorageService,
    private pdf: PdfService,
  ) {
    this.frontendUrl = config.get<string>('frontendUrl')!;
  }

  onModuleInit() {
    this.jobs.register<{ orderId: string }>('radiology.report.generate', async ({ orderId }) => {
      if (!this.pdf.available) return;
      await this.finalPdf(orderId).catch((e) => this.logger.warn(`Radiology PDF ${orderId} failed: ${e.message}`));
    });
  }

  // ─────────────── Writing & approval ───────────────

  async save(user: AuthUser, orderId: string, dto: SaveReportDto, meta: Meta = {}) {
    await this.ds.transaction(async (m) => {
      const o = await this.orders.forCenter(user, orderId, P.RADIOLOGY_REPORTS_WRITE, m);
      if (o.status !== S.REPORTING) throw new BadRequestException('كتابة التقرير متاحة بعد انتهاء الفحص فقط');
      const existing = await m.findOne(RadiologyReport, { where: { orderId } });
      if (existing?.submittedAt) throw new BadRequestException('التقرير مُرسل للاعتماد؛ لا يمكن تعديله إلا إذا أُعيد للتصحيح');
      const data = {
        technique: dto.technique?.trim() || null,
        comparison: dto.comparison?.trim() || null,
        findings: dto.findings.trim(),
        impression: dto.impression.trim(),
        recommendations: dto.recommendations?.trim() || null,
        critical: !!dto.critical,
        reportedById: user.id,
        reportedAt: new Date(),
      };
      if (existing) await m.update(RadiologyReport, existing.id, data);
      else await m.insert(RadiologyReport, { ...data, orderId, verificationCode: secureToken(12) });
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_SAVED', entity: 'radiology_orders', entityId: orderId, newValue: { critical: data.critical, length: data.findings.length }, ...meta }, m);
    });
    return this.orders.get(user, orderId);
  }

  async submit(user: AuthUser, orderId: string, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.orders.forCenter(user, orderId, P.RADIOLOGY_REPORTS_WRITE, m);
      if (o.status !== S.REPORTING) throw new BadRequestException('الحجز ليس في مرحلة كتابة التقرير');
      const r = await m.findOne(RadiologyReport, { where: { orderId } });
      if (!r) throw new BadRequestException('احفظ التقرير أولاً');
      if (r.submittedAt) throw new BadRequestException('التقرير مُرسل بالفعل');
      if (r.findings.length < 10 || r.impression.length < 3) throw new BadRequestException('أكمل النتائج والخلاصة قبل الإرسال');
      await m.update(RadiologyReport, r.id, { submittedAt: new Date(), returnNote: null });
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_SUBMITTED', entity: 'radiology_orders', entityId: orderId, ...meta }, m);
      return o;
    });
    const approvers: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = 'radiology.reports.approve'
        WHERE u.id <> $2 AND (u.id = (SELECT owner_user_id FROM providers WHERE id = $1)
           OR u.id IN (SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active))`,
      [o.center!.providerId, user.id],
    );
    await this.notifications.notifyMany(
      approvers.map((a) => a.id),
      { type: 'RADIOLOGY_REPORT_TO_APPROVE', category: 'RADIOLOGY', title: 'تقرير أشعة بانتظار الاعتماد', body: `الحجز ${o.code} جاهز للاعتماد.`, data: { radiologyOrderId: orderId } },
    );
    await this.orders.broadcast(o);
    return this.orders.get(user, orderId);
  }

  async returnForCorrection(user: AuthUser, orderId: string, note: string, meta: Meta = {}) {
    const { o, reporter } = await this.ds.transaction(async (m) => {
      const o = await this.orders.forCenter(user, orderId, P.RADIOLOGY_REPORTS_APPROVE, m);
      const r = await m.findOne(RadiologyReport, { where: { orderId } });
      if (o.status !== S.REPORTING || !r?.submittedAt) throw new BadRequestException('لا يوجد تقرير بانتظار الاعتماد');
      await m.update(RadiologyReport, r.id, { submittedAt: null, returnNote: note });
      await this.orders.history(m, orderId, o.status, o.status, user.id, `أعيد التقرير للتصحيح: ${note}`);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_RETURNED', entity: 'radiology_orders', entityId: orderId, newValue: { note }, ...meta }, m);
      return { o, reporter: r.reportedById };
    });
    if (reporter && reporter !== user.id) {
      await this.notifications.notify(reporter, { type: 'RADIOLOGY_REPORT_RETURNED', category: 'RADIOLOGY', title: 'تقرير أعيد للتصحيح', body: `${o.code}: ${note}`, data: { radiologyOrderId: orderId } });
    }
    await this.orders.broadcast(o);
    return this.orders.get(user, orderId);
  }

  async approve(user: AuthUser, orderId: string, meta: Meta = {}) {
    const { o, critical, serviceName } = await this.ds.transaction(async (m) => {
      const o = await this.orders.forCenter(user, orderId, P.RADIOLOGY_REPORTS_APPROVE, m);
      const r = await m.findOne(RadiologyReport, { where: { orderId } });
      if (o.status !== S.REPORTING || !r?.submittedAt) throw new BadRequestException('يجب إرسال التقرير للاعتماد أولاً');
      if (o.center!.requireSeparateApprover && r.reportedById === user.id) throw new ForbiddenException('سياسة المركز تتطلب أن يعتمد التقرير طبيب غير الذي كتبه');
      await m.update(RadiologyReport, r.id, { approvedById: user.id, approvedAt: new Date(), pdfFileId: null });
      await m.update(RadiologyOrder, o.id, { status: S.APPROVED });
      await this.orders.history(m, o.id, o.status, S.APPROVED, user.id, null);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_APPROVED', entity: 'radiology_reports', entityId: r.id, newValue: { orderId, critical: r.critical }, ...meta }, m);
      const [svc] = await m.query(`SELECT name FROM radiology_services WHERE id = $1`, [o.serviceId]);
      return { o: { ...o, status: S.APPROVED } as RadiologyOrder, critical: r.critical, serviceName: svc?.name };
    });
    await this.orders.notifyPatient(
      o,
      critical ? 'تقرير الأشعة جاهز — يحتاج متابعة عاجلة' : 'تقرير الأشعة جاهز',
      critical
        ? `تقرير ${serviceName} (${o.code}) يحتوي على نتيجة تستدعي مراجعة طبية عاجلة. من فضلك تواصل مع طبيبك.`
        : `تقرير ${serviceName} (${o.code}) أصبح متاحاً. يمكنك عرضه وتحميله PDF.`,
      critical ? 'RADIOLOGY_REPORT_CRITICAL' : 'RADIOLOGY_REPORT_READY',
      critical,
    );
    this.jobs.add('radiology.report.generate', { orderId });
    await this.orders.broadcast(o);
    return this.orders.get(user, orderId);
  }

  // ─────────────── Patient access ───────────────

  /** Marks the booking delivered the first time the patient opens or downloads the approved report. */
  async markViewed(user: AuthUser, orderId: string, meta: Meta = {}) {
    const o = await this.orders.load(orderId);
    const viewer = await this.orders.viewerFor(user, o);
    if (viewer !== 'PATIENT') return { ok: true };
    if (!RELEASED.includes(o.status)) throw new ForbiddenException('التقرير لم يعتمد بعد');
    await this.deliver(user, o, meta);
    return { ok: true };
  }

  private async deliver(user: AuthUser, o: RadiologyOrder, meta: Meta) {
    if (o.status !== S.APPROVED) return;
    const res = await this.ds
      .createQueryBuilder()
      .update(RadiologyOrder)
      .set({ status: S.DELIVERED, deliveredAt: new Date() })
      .where('id = :id AND status = :st', { id: o.id, st: S.APPROVED })
      .execute();
    if (res.affected) {
      await this.orders.history(this.ds.manager, o.id, S.APPROVED, S.DELIVERED, user.id, 'اطلع المريض على التقرير');
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_VIEWED_BY_PATIENT', entity: 'radiology_orders', entityId: o.id, ...meta });
      await this.orders.broadcast({ ...o, status: S.DELIVERED });
    }
  }

  /** Approved radiology reports of a patient — the patient, or providers with a care relationship. */
  async patientHistory(user: AuthUser, patientId: string, meta: Meta = {}) {
    await this.access.assertCanReadMedicalRecord(user, patientId);
    const rows = await this.ds.query(
      `SELECT o.id, o.code, o.modality, o.scheduled_at, sv.name AS service_name, pr.name_ar AS center_name, pr.slug,
              r.findings, r.impression, r.recommendations, r.critical, r.approved_at,
              (SELECT count(*) FROM radiology_order_files f WHERE f.order_id = o.id)::int AS images
         FROM radiology_orders o JOIN radiology_reports r ON r.order_id = o.id
         JOIN radiology_services sv ON sv.id = o.service_id
         JOIN radiology_centers c ON c.id = o.center_id JOIN providers pr ON pr.id = c.provider_id
        WHERE o.patient_id = $1 AND o.status IN ('APPROVED','DELIVERED') ORDER BY r.approved_at DESC LIMIT 50`,
      [patientId],
    );
    if (user.patientId !== patientId) {
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORTS_VIEWED_BY_PROVIDER', entity: 'patients', entityId: patientId, newValue: { count: rows.length }, ...meta });
    }
    return rows.map((r: any) => ({
      orderId: r.id,
      code: r.code,
      modality: r.modality,
      modalityLabel: MODALITIES[r.modality] ?? r.modality,
      serviceName: r.service_name,
      examDate: r.scheduled_at,
      center: { nameAr: r.center_name, slug: r.slug },
      findings: r.findings,
      impression: r.impression,
      recommendations: r.recommendations,
      critical: r.critical,
      approvedAt: r.approved_at,
      images: r.images,
    }));
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

  private async html(o: RadiologyOrder, draft: boolean) {
    const r = await this.ds.getRepository(RadiologyReport).findOne({ where: { orderId: o.id } });
    if (!r) throw new NotFoundException('لا يوجد تقرير لهذا الحجز بعد');
    const p = o.center!.provider!;
    const fmt = (d?: Date | null) => (d ? DateTime.fromJSDate(new Date(d)).setZone(this.orders.tz).setLocale('ar-EG').toFormat('d LLL yyyy - h:mm a') : null);
    const toData = async (fileId: string | null, max = 2_500_000) => {
      if (!fileId) return null;
      const f = await this.ds.getRepository(FileEntity).findOneBy({ id: fileId });
      if (!f || f.size > max || !f.mimeType.startsWith('image/')) return null;
      try {
        return `data:${f.mimeType};base64,${(await this.readAll(f.storageKey)).toString('base64')}`;
      } catch {
        return null;
      }
    };
    const attachments = await this.ds.query(`SELECT file_id, caption FROM radiology_order_files WHERE order_id = $1 ORDER BY created_at LIMIT 4`, [o.id]);
    const images = (await Promise.all(attachments.map(async (a: any) => ({ dataUrl: await toData(a.file_id), caption: a.caption })))).filter((x) => x.dataUrl) as { dataUrl: string; caption: string | null }[];
    const names = await this.orders.names([r.reportedById, r.approvedById]);
    return radiologyReportHtml({
      fontCss: this.pdf.fonts(),
      draft,
      platformName: await this.settings.get<string>('platform.name'),
      center: { name: p.nameAr, nameEn: p.nameEn, accreditation: o.center!.accreditation, phone: o.branch?.phone || p.phone, address: o.branch?.address, logoDataUrl: await toData(p.logoFileId, 1_500_000) },
      patient: { name: o.patient?.user?.fullName ?? '', gender: o.patient?.gender, age: ageInYears(o.patient?.dateOfBirth, o.createdAt) },
      order: {
        code: o.code,
        service: o.service!.name,
        modality: MODALITIES[o.modality] ?? o.modality,
        examDate: fmt(o.examCompletedAt ?? o.scheduledAt),
        approvedAt: fmt(r.approvedAt),
        printedAt: fmt(new Date())!,
        accession: o.accessionNumber,
        referringDoctor: o.referringDoctor,
        indication: o.clinicalIndication,
      },
      report: { technique: r.technique, comparison: r.comparison, findings: r.findings, impression: r.impression, recommendations: r.recommendations, critical: r.critical },
      images,
      signatures: { reportedBy: names[r.reportedById ?? ''], approvedBy: draft ? null : names[r.approvedById ?? ''] },
      qrDataUrl: !draft ? await this.pdf.qrDataUrl(`${this.frontendUrl.replace(/\/$/, '')}/verify/${r.verificationCode}`) : null,
      verificationCode: !draft ? r.verificationCode : null,
    });
  }

  private async finalPdf(orderId: string) {
    const o = await this.orders.load(orderId);
    const r = await this.ds.getRepository(RadiologyReport).findOneOrFail({ where: { orderId } });
    const fileName = `radiology-report-${o.code}.pdf`;
    if (r.pdfFileId) {
      const f = await this.ds.getRepository(FileEntity).findOneBy({ id: r.pdfFileId });
      if (f) {
        try {
          return { buffer: await this.readAll(f.storageKey), fileName };
        } catch {
          /* regenerate */
        }
      }
    }
    const buffer = await this.pdf.render(await this.html(o, false), { footerTemplate: reportFooter(o.code) });
    const key = `private/radiology_report/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
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
        purpose: 'RADIOLOGY_REPORT',
        uploadedById: r.approvedById ?? undefined,
      }),
    );
    await this.ds.getRepository(RadiologyReport).update(r.id, { pdfFileId: file.id });
    return { buffer, fileName };
  }

  async report(user: AuthUser, orderId: string, meta: Meta = {}) {
    const o = await this.orders.load(orderId);
    const viewer = await this.orders.viewerFor(user, o);
    if (viewer === 'PLATFORM') throw new ForbiddenException('تقارير الأشعة بيانات طبية خاصة بالمريض');
    if (!RELEASED.includes(o.status)) {
      if (viewer !== 'CENTER' || o.status !== S.REPORTING) throw new ForbiddenException('التقرير غير متاح قبل الاعتماد');
      const buffer = await this.pdf.render(await this.html(o, true), { footerTemplate: reportFooter(o.code) });
      return { buffer, fileName: `draft-${o.code}.pdf` };
    }
    const out = await this.finalPdf(orderId);
    await this.audit.log({ userId: user.id, action: 'RADIOLOGY_REPORT_DOWNLOADED', entity: 'radiology_orders', entityId: orderId, newValue: { by: viewer }, ...meta });
    if (viewer === 'PATIENT') await this.deliver(user, o, meta);
    return out;
  }

  async canReadReportFile(user: AuthUser, fileId: string) {
    const r = await this.ds.getRepository(RadiologyReport).findOne({ where: { pdfFileId: fileId } });
    if (!r) return false;
    const o = await this.orders.load(r.orderId);
    try {
      const v = await this.orders.viewerFor(user, o);
      return v === 'CENTER' || (v === 'PATIENT' && RELEASED.includes(o.status));
    } catch {
      return false;
    }
  }

  /** Public authenticity check — no findings, no full name. */
  async verify(code: string) {
    const [row] = await this.ds.query(
      `SELECT r.approved_at, o.code, o.status, o.modality, pr.name_ar, pr.slug, u.full_name, sv.name AS service_name
         FROM radiology_reports r JOIN radiology_orders o ON o.id = r.order_id JOIN radiology_services sv ON sv.id = o.service_id
         JOIN radiology_centers c ON c.id = o.center_id JOIN providers pr ON pr.id = c.provider_id
         JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id
        WHERE r.verification_code = $1`,
      [code],
    );
    if (!row || !row.approved_at || !RELEASED.includes(row.status)) return null;
    const initials = String(row.full_name).split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => `${w.charAt(0)}.`).join(' ');
    return {
      valid: true,
      type: 'RADIOLOGY_REPORT',
      documentNumber: row.code,
      issuer: { name: row.name_ar, slug: row.slug },
      approvedAt: row.approved_at,
      patientInitials: initials,
      examType: MODALITIES[row.modality] ?? row.modality,
    };
  }

  // ─────────────── Dashboard ───────────────

  async dashboard(user: AuthUser, fromIso?: string, toIso?: string) {
    const { center, provider } = await this.catalog.myCenter(user);
    const tz = this.orders.tz;
    const now = DateTime.now().setZone(tz);
    const from = (fromIso ? DateTime.fromISO(fromIso, { zone: tz }) : now.minus({ days: 29 })).startOf('day').toJSDate();
    const to = (toIso ? DateTime.fromISO(toIso, { zone: tz }) : now).endOf('day').toJSDate();
    const d0 = now.startOf('day').toJSDate();
    const d1 = now.endOf('day').toJSDate();
    const id = center.id;
    const [today] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE scheduled_at BETWEEN $2 AND $3 AND status NOT IN ('CANCELLED'))::int AS bookings,
              count(*) FILTER (WHERE scheduled_at BETWEEN $2 AND $3 AND status IN ('BOOKED','CHECKED_IN'))::int AS pending_exams,
              count(*) FILTER (WHERE status = 'EXAMINATION')::int AS in_exam,
              count(*) FILTER (WHERE status = 'REPORTING')::int AS reporting,
              count(*) FILTER (WHERE status = 'REPORTING' AND EXISTS (SELECT 1 FROM radiology_reports r WHERE r.order_id = o.id AND r.submitted_at IS NOT NULL))::int AS awaiting_approval
         FROM radiology_orders o WHERE center_id = $1`,
      [id, d0, d1],
    );
    const [approvedToday] = await this.ds.query(
      `SELECT count(*)::int AS n FROM radiology_reports r JOIN radiology_orders o ON o.id = r.order_id WHERE o.center_id = $1 AND r.approved_at BETWEEN $2 AND $3`,
      [id, d0, d1],
    );
    const [tot] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE status NOT IN ('CANCELLED'))::int AS bookings,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_shows,
              count(DISTINCT patient_id) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS patients,
              coalesce(sum(price - discount) FILTER (WHERE payment_status = 'PAID'), 0)::float AS revenue
         FROM radiology_orders WHERE center_id = $1 AND scheduled_at BETWEEN $2 AND $3`,
      [id, from, to],
    );
    const [tat] = await this.ds.query(
      `SELECT avg(extract(epoch FROM (r.approved_at - o.exam_completed_at)) / 3600)::float AS h,
              count(*) FILTER (WHERE r.critical)::int AS critical
         FROM radiology_reports r JOIN radiology_orders o ON o.id = r.order_id
        WHERE o.center_id = $1 AND r.approved_at BETWEEN $2 AND $3`,
      [id, from, to],
    );
    const byService = await this.ds.query(
      `SELECT sv.name, o.modality, count(*)::int AS count, coalesce(sum(o.price - o.discount) FILTER (WHERE o.payment_status = 'PAID'), 0)::float AS revenue
         FROM radiology_orders o JOIN radiology_services sv ON sv.id = o.service_id
        WHERE o.center_id = $1 AND o.scheduled_at BETWEEN $2 AND $3 AND o.status NOT IN ('CANCELLED')
        GROUP BY sv.name, o.modality ORDER BY count(*) DESC LIMIT 10`,
      [id, from, to],
    );
    const byBranch = await this.ds.query(
      `SELECT b.name, count(o.*)::int AS count, coalesce(sum(o.price - o.discount) FILTER (WHERE o.payment_status = 'PAID'), 0)::float AS revenue,
              count(*) FILTER (WHERE o.status = 'NO_SHOW')::int AS no_shows
         FROM provider_branches b LEFT JOIN radiology_orders o ON o.branch_id = b.id AND o.scheduled_at BETWEEN $2 AND $3 AND o.status <> 'CANCELLED'
        WHERE b.provider_id = $1 GROUP BY b.name ORDER BY count(o.*) DESC`,
      [provider.id, from, to],
    );
    const byModality = await this.ds.query(
      `SELECT modality, count(*)::int AS count FROM radiology_orders WHERE center_id = $1 AND scheduled_at BETWEEN $2 AND $3 AND status <> 'CANCELLED' GROUP BY modality ORDER BY count(*) DESC`,
      [id, from, to],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM radiology_orders o WHERE o.center_id = $1 AND o.status <> 'CANCELLED' AND (o.scheduled_at AT TIME ZONE $4)::date = d::date)::int AS bookings,
              (SELECT coalesce(sum(o.price - o.discount), 0) FROM radiology_orders o WHERE o.center_id = $1 AND o.payment_status = 'PAID' AND (o.paid_at AT TIME ZONE $4)::date = d::date)::float AS revenue
         FROM generate_series(($2::timestamptz AT TIME ZONE $4)::date, ($3::timestamptz AT TIME ZONE $4)::date, interval '1 day') d`,
      [id, from, to, tz],
    );
    return {
      today: {
        bookings: today.bookings,
        pendingExams: today.pending_exams,
        inExam: today.in_exam,
        reporting: today.reporting,
        awaitingApproval: today.awaiting_approval,
        approvedToday: approvedToday.n,
      },
      totals: {
        bookings: tot.bookings,
        cancelled: tot.cancelled,
        noShows: tot.no_shows,
        patients: tot.patients,
        revenue: tot.revenue,
        criticalReports: tat?.critical ?? 0,
        avgReportHours: tat?.h ? Math.round(tat.h * 10) / 10 : null,
      },
      byService: byService.map((x: any) => ({ ...x, modalityLabel: MODALITIES[x.modality] ?? x.modality })),
      byBranch,
      byModality: byModality.map((x: any) => ({ ...x, label: MODALITIES[x.modality] ?? x.modality })),
      daily,
    };
  }
}
