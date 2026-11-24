import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import {
  FileEntity,
  FileVisibility,
  LabOrder,
  LabOrderStatus,
  LabResult,
  LabResultItem,
  LabTestParameter,
  ResultFlag,
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
import { LabOrdersService } from './lab-orders.service';
import { SaveResultsDto } from './labs.dto';
import { LAB_STATUS_AR, RELEASED_STATUSES, ageInYears, flagResult, formatRange, pickRange } from './lab-logic';
import { labReportHtml, reportFooter } from './lab-report.template';

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

const LAB_READ_PERMS = [P.LAB_RESULTS_ENTER, P.LAB_RESULTS_REVIEW, P.LAB_RESULTS_APPROVE, P.LAB_ORDERS_MANAGE];

@Injectable()
export class LabResultsService implements OnModuleInit {
  private readonly logger = new Logger(LabResultsService.name);
  private readonly frontendUrl: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private orders: LabOrdersService,
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
    // Final PDFs are produced in the background right after approval and cached as private files.
    this.jobs.register<{ orderId: string }>('lab.report.generate', async ({ orderId }) => {
      if (!this.pdf.available) return;
      await this.finalReport(orderId).catch((e) => this.logger.warn(`Report generation for ${orderId} failed: ${e.message}`));
    });
  }

  verifyUrl(code: string) {
    return `${this.frontendUrl.replace(/\/$/, '')}/verify/${code}`;
  }

  private assertLabRead(user: AuthUser) {
    if (!LAB_READ_PERMS.some((p) => user.permissions.has(p))) throw new ForbiddenException('لا تملك صلاحية الاطلاع على النتائج');
  }

  // ─────────────── Worksheet (definitions + current values) ───────────────

  /** Every parameter the order needs, with the reference range chosen for THIS patient (gender/age). */
  private async definitions(m: EntityManager, order: LabOrder) {
    const tests = this.orders.expandTests(order);
    const params = tests.length
      ? await m.find(LabTestParameter, { where: { testId: In(tests.map((t) => t.testId)) }, relations: { ranges: true }, order: { sortOrder: 'ASC' } })
      : [];
    const p = order.patient!;
    const age = ageInYears(p.dateOfBirth, order.createdAt);
    return {
      age,
      gender: p.gender,
      tests: tests.map((t) => ({
        ...t,
        parameters: params
          .filter((x) => x.testId === t.testId)
          .map((x) => {
            const range = pickRange(x.ranges ?? [], p.gender, age);
            return { id: x.id, name: x.name, unit: x.unit, resultType: x.resultType, range, referenceRange: formatRange(range) };
          }),
      })),
    };
  }

  async worksheet(user: AuthUser, orderId: string) {
    const order = await this.orders.load(orderId);
    if (!user.providerIds.includes(order.laboratory!.providerId)) throw new NotFoundException('الطلب غير موجود');
    this.assertLabRead(user);
    const defs = await this.definitions(this.ds.manager, order);
    const result = await this.ds.getRepository(LabResult).findOne({ where: { orderId }, relations: { items: true } });
    const names = await this.userNames([result?.enteredById, result?.reviewedById, result?.approvedById]);
    return {
      orderId,
      code: order.code,
      status: order.status,
      statusLabel: LAB_STATUS_AR[order.status],
      patient: { fullName: order.patient?.user?.fullName, gender: defs.gender, ageYears: defs.age },
      tests: defs.tests.map((t) => ({
        ...t,
        parameters: t.parameters.map((x) => {
          const item = result?.items?.find((i) => i.parameterId === x.id);
          return {
            id: x.id,
            name: x.name,
            unit: x.unit,
            resultType: x.resultType,
            referenceRange: x.referenceRange,
            range: x.range && { low: x.range.low, high: x.range.high, criticalLow: x.range.criticalLow, criticalHigh: x.range.criticalHigh, textRange: x.range.textRange },
            value: item?.value ?? '',
            flag: item?.flag ?? null,
            notes: item?.notes ?? '',
          };
        }),
      })),
      result: result
        ? {
            id: result.id,
            notes: result.notes,
            returnNote: result.returnNote,
            criticalCount: result.criticalCount,
            enteredAt: result.enteredAt,
            enteredBy: names[result.enteredById ?? ''] ?? null,
            enteredById: result.enteredById,
            reviewedAt: result.reviewedAt,
            reviewedBy: names[result.reviewedById ?? ''] ?? null,
            approvedAt: result.approvedAt,
            approvedBy: names[result.approvedById ?? ''] ?? null,
          }
        : null,
      can: this.orders.capabilities(user, 'LAB', order, result),
    };
  }

  private async userNames(ids: (string | null | undefined)[]) {
    const list = [...new Set(ids.filter(Boolean))] as string[];
    if (!list.length) return {} as Record<string, string>;
    const rows: { id: string; full_name: string }[] = await this.ds.query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [list]);
    return Object.fromEntries(rows.map((r) => [r.id, r.full_name])) as Record<string, string>;
  }

  // ─────────────── Entry ───────────────

  async save(user: AuthUser, orderId: string, dto: SaveResultsDto, meta: Meta = {}) {
    const alertsOn = await this.settings.get<boolean>('lab.criticalAlertsEnabled');
    const out = await this.ds.transaction(async (m) => {
      const locked = await this.orders.forLab(user, orderId, P.LAB_RESULTS_ENTER, m);
      if (![LabOrderStatus.PROCESSING, LabOrderStatus.RESULT_ENTERED].includes(locked.status)) {
        throw new BadRequestException(
          locked.status === LabOrderStatus.UNDER_REVIEW
            ? 'النتائج قيد المراجعة؛ لا يمكن تعديلها إلا إذا أعادها المراجع'
            : `لا يمكن إدخال النتائج في مرحلة "${LAB_STATUS_AR[locked.status]}" — انقل الطلب إلى "جاري التحليل" أولاً`,
        );
      }
      const order = await this.orders.load(orderId, m);
      const defs = await this.definitions(m, order);
      const byId = new Map(defs.tests.flatMap((t) => t.parameters.map((p) => [p.id, { ...p, testId: t.testId, testName: t.name }] as const)));

      let result = await m.findOne(LabResult, { where: { orderId }, relations: { items: true } });
      if (!result) {
        result = await m.save(m.create(LabResult, { orderId, verificationCode: secureToken(12) }));
        result.items = [];
      }
      const before = new Map((result.items ?? []).map((i) => [i.parameterId, i]));
      const newlyCritical: string[] = [];

      for (const e of dto.items) {
        const def = byId.get(e.parameterId);
        if (!def) throw new BadRequestException('بند غير تابع لتحاليل هذا الطلب');
        const value = e.value.trim();
        if (!value) {
          await m.delete(LabResultItem, { resultId: result.id, parameterId: def.id });
          continue;
        }
        let outcome;
        try {
          outcome = flagResult(value, def.resultType, def.range, e.flag);
        } catch {
          throw new BadRequestException(`قيمة "${def.name}" يجب أن تكون رقماً`);
        }
        if (outcome.flag === ResultFlag.CRITICAL && before.get(def.id)?.flag !== ResultFlag.CRITICAL) newlyCritical.push(`${def.name}: ${value} ${def.unit ?? ''}`.trim());
        await m.upsert(
          LabResultItem,
          {
            resultId: result.id,
            parameterId: def.id,
            testId: def.testId,
            value,
            numericValue: outcome.numericValue,
            unit: def.unit,
            referenceRange: outcome.referenceRange,
            flag: outcome.flag,
            notes: e.notes?.trim() || null,
          },
          ['resultId', 'parameterId'],
        );
      }

      const items = await m.find(LabResultItem, { where: { resultId: result.id } });
      const required = byId.size;
      const complete = required > 0 && items.length >= required;
      const criticalCount = items.filter((i) => i.flag === ResultFlag.CRITICAL).length;
      await m.update(LabResult, result.id, {
        criticalCount,
        enteredById: user.id,
        enteredAt: new Date(),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      });
      const next = complete ? LabOrderStatus.RESULT_ENTERED : LabOrderStatus.PROCESSING;
      if (next !== locked.status) {
        await m.update(LabOrder, orderId, { status: next });
        await this.orders.history(m, orderId, locked.status, next, user.id, null);
      }
      await this.audit.log(
        { userId: user.id, action: 'LAB_RESULTS_ENTERED', entity: 'lab_results', entityId: result.id, newValue: { orderId, parameters: dto.items.length, complete, criticalCount }, ...meta },
        m,
      );
      return { order: { ...locked, status: next }, newlyCritical, providerId: order.laboratory!.providerId, patientName: order.patient?.user?.fullName };
    });

    if (alertsOn && out.newlyCritical.length) {
      const admins = await this.orders.teamUserIds(out.providerId, this.ds.manager, true);
      await this.notifications.notifyMany(admins, {
        type: 'LAB_CRITICAL_VALUE',
        category: 'LAB_RESULTS',
        title: '⚠ قيمة حرجة في نتيجة تحليل',
        body: `${out.order.code} — ${out.patientName}: ${out.newlyCritical.join('، ')}`,
        data: { labOrderId: orderId },
        force: true,
      });
    }
    await this.orders.broadcast(out.order);
    return this.worksheet(user, orderId);
  }

  // ─────────────── Review & approval ───────────────

  async submitForReview(user: AuthUser, orderId: string, meta: Meta = {}) {
    const order = await this.ds.transaction(async (m) => {
      const o = await this.orders.forLab(user, orderId, P.LAB_RESULTS_ENTER, m);
      if (o.status !== LabOrderStatus.RESULT_ENTERED) throw new BadRequestException('أكمل إدخال كل النتائج أولاً');
      await m.update(LabOrder, o.id, { status: LabOrderStatus.UNDER_REVIEW });
      await m.update(LabResult, { orderId }, { returnNote: null });
      await this.orders.history(m, o.id, o.status, LabOrderStatus.UNDER_REVIEW, user.id, null);
      await this.audit.log({ userId: user.id, action: 'LAB_RESULTS_SUBMITTED', entity: 'lab_orders', entityId: o.id, ...meta }, m);
      return { ...o, status: LabOrderStatus.UNDER_REVIEW } as LabOrder;
    });
    const reviewers: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id AND p.code IN ('lab.results.review','lab.results.approve')
        WHERE u.id <> $2 AND (u.id = (SELECT owner_user_id FROM providers WHERE id = $1)
           OR u.id IN (SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active))`,
      [order.laboratory!.providerId, user.id],
    );
    await this.notifications.notifyMany(
      reviewers.map((r) => r.id),
      { type: 'LAB_RESULTS_TO_REVIEW', category: 'LAB_RESULTS', title: 'نتائج بانتظار المراجعة', body: `الطلب ${order.code} جاهز للمراجعة والاعتماد.`, data: { labOrderId: orderId } },
    );
    await this.orders.broadcast(order);
    return this.worksheet(user, orderId);
  }

  async markReviewed(user: AuthUser, orderId: string, note: string | undefined, meta: Meta = {}) {
    await this.ds.transaction(async (m) => {
      const o = await this.orders.forLab(user, orderId, P.LAB_RESULTS_REVIEW, m);
      if (o.status !== LabOrderStatus.UNDER_REVIEW) throw new BadRequestException('الطلب ليس قيد المراجعة');
      await m.update(LabResult, { orderId }, { reviewedById: user.id, reviewedAt: new Date() });
      await this.audit.log({ userId: user.id, action: 'LAB_RESULTS_REVIEWED', entity: 'lab_orders', entityId: o.id, newValue: { note }, ...meta }, m);
    });
    return this.worksheet(user, orderId);
  }

  async returnForCorrection(user: AuthUser, orderId: string, note: string, meta: Meta = {}) {
    const { order, enteredById } = await this.ds.transaction(async (m) => {
      const o = await this.orders.forLab(user, orderId, P.LAB_RESULTS_REVIEW, m);
      if (o.status !== LabOrderStatus.UNDER_REVIEW) throw new BadRequestException('الطلب ليس قيد المراجعة');
      const r = await m.findOneOrFail(LabResult, { where: { orderId } });
      await m.update(LabResult, r.id, { returnNote: note, reviewedById: null, reviewedAt: null });
      await m.update(LabOrder, o.id, { status: LabOrderStatus.RESULT_ENTERED });
      await this.orders.history(m, o.id, o.status, LabOrderStatus.RESULT_ENTERED, user.id, `أعيدت للتصحيح: ${note}`);
      await this.audit.log({ userId: user.id, action: 'LAB_RESULTS_RETURNED', entity: 'lab_orders', entityId: o.id, newValue: { note }, ...meta }, m);
      return { order: { ...o, status: LabOrderStatus.RESULT_ENTERED } as LabOrder, enteredById: r.enteredById };
    });
    if (enteredById && enteredById !== user.id) {
      await this.notifications.notify(enteredById, {
        type: 'LAB_RESULTS_RETURNED',
        category: 'LAB_RESULTS',
        title: 'نتائج أعيدت للتصحيح',
        body: `${order.code}: ${note}`,
        data: { labOrderId: orderId },
      });
    }
    await this.orders.broadcast(order);
    return this.worksheet(user, orderId);
  }

  async approve(user: AuthUser, orderId: string, meta: Meta = {}) {
    const res = await this.ds.transaction(async (m) => {
      const o = await this.orders.forLab(user, orderId, P.LAB_RESULTS_APPROVE, m);
      if (o.status !== LabOrderStatus.UNDER_REVIEW) throw new BadRequestException('يجب إرسال النتائج للمراجعة قبل الاعتماد');
      const r = await m.findOneOrFail(LabResult, { where: { orderId } });
      if (o.laboratory!.requireSeparateApprover && r.enteredById === user.id) {
        throw new ForbiddenException('سياسة المعمل تتطلب أن يعتمد النتيجة شخص غير الذي أدخلها');
      }
      const now = new Date();
      await m.update(LabResult, r.id, {
        approvedById: user.id,
        approvedAt: now,
        reviewedById: r.reviewedById ?? user.id,
        reviewedAt: r.reviewedAt ?? now,
        pdfFileId: null,
      });
      await m.update(LabOrder, o.id, { status: LabOrderStatus.APPROVED });
      await this.orders.history(m, o.id, o.status, LabOrderStatus.APPROVED, user.id, null);
      await this.audit.log({ userId: user.id, action: 'LAB_RESULT_APPROVED', entity: 'lab_results', entityId: r.id, newValue: { orderId, criticalCount: r.criticalCount }, ...meta }, m);
      return { order: { ...o, status: LabOrderStatus.APPROVED } as LabOrder, critical: r.criticalCount };
    });
    const alertsOn = await this.settings.get<boolean>('lab.criticalAlertsEnabled');
    const [p] = await this.ds.query(`SELECT pr.name_ar FROM laboratories l JOIN providers pr ON pr.id = l.provider_id WHERE l.id = $1`, [res.order.laboratoryId]);
    const critical = alertsOn && res.critical > 0;
    const [pt] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [res.order.patientId]);
    if (pt) {
      await this.notifications.notify(pt.user_id, {
        type: critical ? 'LAB_RESULT_CRITICAL' : 'LAB_RESULT_READY',
        category: 'LAB_RESULTS',
        title: critical ? 'نتيجة تحاليلك جاهزة — تحتاج متابعة عاجلة' : 'نتيجة تحاليلك جاهزة',
        body: critical
          ? `نتيجة طلبك ${res.order.code} من ${p?.name_ar} تحتوي على قيم تحتاج مراجعة طبية عاجلة. من فضلك تواصل مع طبيبك.`
          : `نتيجة طلبك ${res.order.code} من ${p?.name_ar} أصبحت متاحة. يمكنك عرضها وتحميل التقرير PDF.`,
        data: { labOrderId: orderId },
        force: critical,
      });
    }
    this.jobs.add('lab.report.generate', { orderId });
    await this.orders.broadcast(res.order);
    return this.worksheet(user, orderId);
  }

  async markDelivered(user: AuthUser, orderId: string, meta: Meta = {}) {
    return this.orders.changeStatus(user, orderId, { status: LabOrderStatus.DELIVERED }, meta);
  }

  // ─────────────── Reading results ───────────────

  /** Grouped results. Patients see them only once approved (first view marks the order delivered). */
  async results(user: AuthUser, orderId: string, meta: Meta = {}) {
    const order = await this.orders.load(orderId);
    const viewer = await this.orders.viewerFor(user, order);
    if (viewer === 'PLATFORM') throw new ForbiddenException('نتائج التحاليل بيانات طبية خاصة بالمريض');
    if (viewer === 'LAB') this.assertLabRead(user);
    if (viewer === 'PATIENT' && !RELEASED_STATUSES.includes(order.status)) throw new ForbiddenException('النتيجة لم تعتمد بعد');
    const data = await this.compose(order);
    if (!data) throw new NotFoundException('لا توجد نتائج لهذا الطلب بعد');
    if (viewer === 'PATIENT') await this.deliverOnPatientAccess(user, order, meta);
    return data;
  }

  private async deliverOnPatientAccess(user: AuthUser, order: LabOrder, meta: Meta) {
    if (order.status !== LabOrderStatus.APPROVED) return;
    const res = await this.ds
      .createQueryBuilder()
      .update(LabOrder)
      .set({ status: LabOrderStatus.DELIVERED, deliveredAt: new Date() })
      .where('id = :id AND status = :st', { id: order.id, st: LabOrderStatus.APPROVED })
      .execute();
    if (res.affected) {
      await this.orders.history(this.ds.manager, order.id, LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED, user.id, 'اطلع المريض على النتيجة');
      await this.audit.log({ userId: user.id, action: 'LAB_RESULT_VIEWED_BY_PATIENT', entity: 'lab_orders', entityId: order.id, ...meta });
      await this.orders.broadcast({ ...order, status: LabOrderStatus.DELIVERED });
    }
  }

  private async compose(order: LabOrder) {
    const result = await this.ds.getRepository(LabResult).findOne({ where: { orderId: order.id }, relations: { items: { parameter: true } } });
    if (!result) return null;
    const tests = this.orders.expandTests(order);
    const names = await this.userNames([result.enteredById, result.reviewedById, result.approvedById]);
    const groups = tests
      .map((t) => ({
        testId: t.testId,
        code: t.code,
        name: t.name,
        packageName: t.packageName,
        items: (result.items ?? [])
          .filter((i) => (i.testId ?? i.parameter?.testId) === t.testId)
          .sort((a, b) => (a.parameter?.sortOrder ?? 0) - (b.parameter?.sortOrder ?? 0))
          .map((i) => ({ parameterId: i.parameterId, name: i.parameter?.name ?? '', value: i.value, unit: i.unit, referenceRange: i.referenceRange, flag: i.flag, notes: i.notes })),
      }))
      .filter((g) => g.items.length);
    return {
      orderId: order.id,
      code: order.code,
      status: order.status,
      approvedAt: result.approvedAt,
      enteredBy: names[result.enteredById ?? ''] ?? null,
      reviewedBy: names[result.reviewedById ?? ''] ?? null,
      approvedBy: names[result.approvedById ?? ''] ?? null,
      criticalCount: result.criticalCount,
      notes: result.notes,
      verificationCode: RELEASED_STATUSES.includes(order.status) ? result.verificationCode : null,
      groups,
      result,
    };
  }

  /** Approved lab results for a patient — for the patient and for providers with a care relationship. */
  async patientHistory(user: AuthUser, patientId: string, meta: Meta = {}) {
    await this.access.assertCanReadMedicalRecord(user, patientId);
    const orders = await this.ds.getRepository(LabOrder).find({
      where: { patientId, status: In(RELEASED_STATUSES) },
      relations: { laboratory: { provider: true }, items: { test: true, package: { items: { test: true } } }, patient: { user: true } },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    const out: any[] = [];
    for (const o of orders) {
      const c = await this.compose(o);
      if (!c) continue;
      const { result: _r, ...rest } = c;
      out.push({ ...rest, laboratory: { nameAr: o.laboratory!.provider!.nameAr, slug: o.laboratory!.provider!.slug } });
    }
    if (user.patientId !== patientId) {
      await this.audit.log({ userId: user.id, action: 'LAB_RESULTS_VIEWED_BY_PROVIDER', entity: 'patients', entityId: patientId, newValue: { orders: out.length }, ...meta });
    }
    return out;
  }

  // ─────────────── PDF ───────────────

  private async reportHtml(order: LabOrder, draft: boolean) {
    const data = await this.compose(order);
    if (!data) throw new NotFoundException('لا توجد نتائج لهذا الطلب بعد');
    const p = order.laboratory!.provider!;
    const fmt = (d?: Date | null) => (d ? DateTime.fromJSDate(new Date(d)).setZone(this.orders.tz).setLocale('ar-EG').toFormat('d LLL yyyy - h:mm a') : null);
    const samples = (order.samples ?? []).filter((s) => !s.rejectedAt);
    const collected = samples.map((s) => s.collectedAt).filter(Boolean).sort((a, b) => +a! - +b!)[0] ?? null;
    const received = samples.map((s) => s.receivedAt).filter(Boolean).sort((a, b) => +a! - +b!)[0] ?? null;
    let logoDataUrl: string | null = null;
    if (p.logoFileId) {
      const f = await this.ds.getRepository(FileEntity).findOneBy({ id: p.logoFileId });
      if (f && f.size < 1_500_000) {
        try {
          logoDataUrl = `data:${f.mimeType};base64,${(await this.readAll(f.storageKey)).toString('base64')}`;
        } catch {
          logoDataUrl = null;
        }
      }
    }
    const branch = order.branch ?? (await this.ds.query(`SELECT name, address, phone FROM provider_branches WHERE provider_id = $1 AND is_active ORDER BY created_at LIMIT 1`, [p.id]))[0];
    const code = data.verificationCode;
    const platformName = await this.settings.get<string>('platform.name');
    return labReportHtml({
      fontCss: this.pdf.fonts(),
      draft,
      platformName,
      lab: { name: p.nameAr, nameEn: p.nameEn, accreditation: order.laboratory!.accreditation, phone: branch?.phone || p.phone, address: branch?.address, logoDataUrl },
      patient: { name: order.patient?.user?.fullName ?? '', gender: order.patient?.gender, age: ageInYears(order.patient?.dateOfBirth, order.createdAt) },
      order: {
        code: order.code,
        scheduledAt: fmt(order.scheduledAt),
        collectedAt: fmt(collected),
        receivedAt: fmt(received),
        approvedAt: fmt(data.approvedAt),
        printedAt: fmt(new Date())!,
        home: order.homeCollection,
      },
      groups: data.groups.map((g) => ({
        title: g.name,
        code: g.code,
        packageName: g.packageName,
        rows: g.items.map((i) => ({ name: i.name, value: i.value, unit: i.unit, ref: i.referenceRange, flag: i.flag, notes: i.notes })),
      })),
      notes: data.notes,
      signatures: { enteredBy: data.enteredBy, reviewedBy: draft ? null : data.reviewedBy, approvedBy: draft ? null : data.approvedBy },
      qrDataUrl: code && !draft ? await this.pdf.qrDataUrl(this.verifyUrl(code)) : null,
      verifyUrl: code ? this.verifyUrl(code) : null,
      verificationCode: code,
    });
  }

  private async readAll(key: string): Promise<Buffer> {
    const stream = await this.storage.driver.get(key);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /** Generates (once) and stores the approved report as a private file. */
  private async finalReport(orderId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const order = await this.orders.load(orderId);
    const result = await this.ds.getRepository(LabResult).findOneOrFail({ where: { orderId } });
    const fileName = `lab-report-${order.code}.pdf`;
    if (result.pdfFileId) {
      const f = await this.ds.getRepository(FileEntity).findOneBy({ id: result.pdfFileId });
      if (f) {
        try {
          return { buffer: await this.readAll(f.storageKey), fileName };
        } catch {
          /* regenerate below */
        }
      }
    }
    const buffer = await this.pdf.render(await this.reportHtml(order, false), { footerTemplate: reportFooter(order.code) });
    const key = `private/lab_report/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
    await this.storage.driver.put(key, buffer, 'application/pdf');
    const file = await this.ds.getRepository(FileEntity).save(
      this.ds.getRepository(FileEntity).create({
        storageKey: key,
        driver: this.storage.driver.name,
        originalName: fileName,
        mimeType: 'application/pdf',
        size: buffer.length,
        checksum: createHash('sha256').update(buffer).digest('hex'),
        visibility: FileVisibility.PRIVATE,
        purpose: 'LAB_REPORT',
        uploadedById: result.approvedById ?? undefined,
      }),
    );
    await this.ds.getRepository(LabResult).update(result.id, { pdfFileId: file.id });
    return { buffer, fileName };
  }

  async report(user: AuthUser, orderId: string, meta: Meta = {}) {
    const order = await this.orders.load(orderId);
    const viewer = await this.orders.viewerFor(user, order);
    if (viewer === 'PLATFORM') throw new ForbiddenException('نتائج التحاليل بيانات طبية خاصة بالمريض');
    if (viewer === 'LAB') this.assertLabRead(user);
    const released = RELEASED_STATUSES.includes(order.status);
    if (!released) {
      // Lab staff can preview a watermarked draft while the result is being entered/reviewed.
      if (viewer !== 'LAB' || ![LabOrderStatus.RESULT_ENTERED, LabOrderStatus.UNDER_REVIEW, LabOrderStatus.PROCESSING].includes(order.status)) {
        throw new ForbiddenException('التقرير غير متاح قبل اعتماد النتيجة');
      }
      const buffer = await this.pdf.render(await this.reportHtml(order, true), { footerTemplate: reportFooter(order.code) });
      return { buffer, fileName: `draft-${order.code}.pdf` };
    }
    const out = await this.finalReport(orderId);
    await this.audit.log({ userId: user.id, action: 'LAB_REPORT_DOWNLOADED', entity: 'lab_orders', entityId: orderId, newValue: { by: viewer }, ...meta });
    if (viewer === 'PATIENT') await this.deliverOnPatientAccess(user, order, meta);
    return out;
  }

  /** May this user download the stored report file through /files/:id? */
  async canReadReportFile(user: AuthUser, fileId: string) {
    const r = await this.ds.getRepository(LabResult).findOne({ where: { pdfFileId: fileId } });
    if (!r) return false;
    const order = await this.orders.load(r.orderId);
    try {
      const viewer = await this.orders.viewerFor(user, order);
      return viewer === 'LAB' || (viewer === 'PATIENT' && RELEASED_STATUSES.includes(order.status));
    } catch {
      return false;
    }
  }

  // ─────────────── Public verification ───────────────

  /** Confirms authenticity only. No values, no full name, no contact data. */
  async verify(code: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return { valid: false };
    const [row] = await this.ds.query(
      `SELECT r.approved_at, o.code, o.status, pr.name_ar, pr.slug, u.full_name,
              (SELECT count(DISTINCT i.test_id) FROM lab_result_items i WHERE i.result_id = r.id)::int AS tests
         FROM lab_results r JOIN lab_orders o ON o.id = r.order_id
         JOIN laboratories l ON l.id = o.laboratory_id JOIN providers pr ON pr.id = l.provider_id
         JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id
        WHERE r.verification_code = $1`,
      [code],
    );
    if (!row || !row.approved_at || !RELEASED_STATUSES.includes(row.status)) return { valid: false };
    const initials = String(row.full_name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w: string) => `${w.charAt(0)}.`)
      .join(' ');
    return {
      valid: true,
      type: 'LAB_REPORT',
      documentNumber: row.code,
      issuer: { name: row.name_ar, slug: row.slug },
      approvedAt: row.approved_at,
      patientInitials: initials,
      testsCount: row.tests,
    };
  }
}
