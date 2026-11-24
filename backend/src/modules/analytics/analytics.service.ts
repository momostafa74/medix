import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth-user';
import { likeEscape } from '../../common/dto/pagination.dto';
import { P } from '../../common/permissions';
import { CacheService } from '../../common/cache/cache.service';
import { ageGroup, autoGranularity, bucketKeys, buildCohorts, fillSeries, Granularity, makeRange, pctChange, previousRange, Range, ratio, yearAgoRange } from './analytics-logic';

/**
 * Platform & provider analytics on top of the `analytics_bookings` view (appointments, lab,
 * radiology and pharmacy orders in one shape) and the payments ledger. Every number can be
 * compared with the previous period or the same period last year.
 */
export type Compare = 'previous' | 'year' | 'none';
type Scope = string[] | null; // provider ids, or null = whole platform

const LEADERBOARD_SORTS: Record<string, string> = {
  bookings: 'bookings',
  completed: 'completed',
  gmv: 'gmv',
  commission: 'commission',
  completionRate: 'completion_rate',
  cancellationRate: 'cancellation_rate',
  rating: 'rating',
  patients: 'patients',
};

@Injectable()
export class AnalyticsService {
  private tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private cache: CacheService,
  ) {
    this.tz = config.get<string>('timezone') ?? 'Africa/Cairo';
  }

  range(from?: string, to?: string) {
    return makeRange(from, to, this.tz);
  }

  /** Which providers a provider-side user may analyse (owner / admin staff). */
  providerScope(user: AuthUser): string[] {
    const ids = user.adminProviderIds.length ? user.adminProviderIds : user.permissions.has(P.DASHBOARD_PROVIDER) ? user.providerIds : [];
    if (!ids.length) throw new ForbiddenException('هذا الحساب غير مرتبط بمقدم خدمة');
    return ids;
  }

  private compareRange(r: Range, compare: Compare) {
    return compare === 'none' ? null : compare === 'year' ? yearAgoRange(r, this.tz) : previousRange(r, this.tz);
  }

  /** Short cache: dashboards are opened repeatedly; data changes are not real-time critical here. */
  private cached<T>(key: string, fn: () => Promise<T>) {
    return this.cache.wrap(`analytics:${key}`, 60_000, fn, ['analytics']);
  }

  // ─────────────────────────── KPIs ───────────────────────────

  private async kpis(r: Range, scope: Scope) {
    const p = [r.start, r.end, scope];
    const [b] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE outcome <> 'RESCHEDULED')::int AS bookings,
              count(*) FILTER (WHERE outcome = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE outcome = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE outcome = 'NO_SHOW')::int AS no_show,
              count(DISTINCT patient_id)::int AS active_patients,
              count(DISTINCT provider_id)::int AS active_providers,
              coalesce(sum(discount) FILTER (WHERE outcome <> 'RESCHEDULED'), 0)::float AS discounts
         FROM analytics_bookings
        WHERE created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR provider_id = ANY($3))`,
      p,
    );
    // Patients whose very first booking (on the platform, or with this provider) falls in the period.
    const [np] = await this.ds.query(
      `SELECT count(*)::int AS n FROM (
         SELECT patient_id, min(created_at) AS first_at FROM analytics_bookings
          WHERE ($3::uuid[] IS NULL OR provider_id = ANY($3)) AND outcome <> 'RESCHEDULED'
          GROUP BY patient_id) f
        WHERE f.first_at >= $1 AND f.first_at < $2`,
      p,
    );
    const [m] = await this.ds.query(
      `SELECT coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION'), 0)::float AS gmv,
              count(*) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION')::int AS paid_count,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION' AND p.collected_by = 'PLATFORM'), 0)::float AS online,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type = 'SUBSCRIPTION'), 0)::float AS subscriptions,
              coalesce(sum(p.refunded_amount), 0)::float AS refunds,
              coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission,
              coalesce(sum(c.provider_amount - c.reversed_provider_amount), 0)::float AS provider_net
         FROM payments p LEFT JOIN commissions c ON c.payment_id = p.id
        WHERE p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') AND p.paid_at >= $1 AND p.paid_at < $2
          AND ($3::uuid[] IS NULL OR p.provider_id = ANY($3))`,
      p,
    );
    const [rv] = await this.ds.query(
      `SELECT coalesce(avg(rating), 0)::float AS rating, count(*)::int AS reviews FROM reviews
        WHERE status = 'PUBLISHED' AND created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR provider_id = ANY($3))`,
      p,
    );
    const platform = !scope
      ? (
          await this.ds.query(
            `SELECT (SELECT count(*) FROM patients WHERE created_at >= $1 AND created_at < $2)::int AS registered_patients,
                    (SELECT count(*) FROM providers WHERE created_at >= $1 AND created_at < $2)::int AS new_providers,
                    (SELECT count(*) FROM providers WHERE verified_at >= $1 AND verified_at < $2 AND verification_status = 'APPROVED')::int AS approved_providers`,
            [r.start, r.end],
          )
        )[0]
      : null;
    const closed = b.completed + b.cancelled + b.no_show;
    const out: Record<string, number> = {
      bookings: b.bookings,
      completed: b.completed,
      cancelled: b.cancelled,
      noShow: b.no_show,
      completionRate: ratio(b.completed, closed),
      cancellationRate: ratio(b.cancelled, b.bookings),
      noShowRate: ratio(b.no_show, b.bookings),
      activePatients: b.active_patients,
      newPatients: np.n,
      returningPatients: Math.max(0, b.active_patients - np.n),
      repeatRate: ratio(Math.max(0, b.active_patients - np.n), b.active_patients),
      gmv: Math.round(m.gmv * 100) / 100,
      onlineShare: ratio(m.online, m.gmv),
      avgOrderValue: m.paid_count ? Math.round((m.gmv / m.paid_count) * 100) / 100 : 0,
      refunds: m.refunds,
      discounts: b.discounts,
      rating: Math.round(rv.rating * 10) / 10,
      reviews: rv.reviews,
    };
    if (scope) {
      out.netRevenue = Math.round(m.provider_net * 100) / 100;
      out.commission = Math.round(m.commission * 100) / 100;
    } else {
      out.commission = Math.round(m.commission * 100) / 100;
      out.subscriptions = m.subscriptions;
      out.platformRevenue = Math.round((m.commission + m.subscriptions) * 100) / 100;
      out.activeProviders = b.active_providers;
      out.registeredPatients = platform.registered_patients;
      out.newProviders = platform.new_providers;
      out.approvedProviders = platform.approved_providers;
    }
    return out;
  }

  async overview(r: Range, compare: Compare, scope: Scope) {
    return this.cached(`overview:${r.from}:${r.to}:${compare}:${scope?.join(',') ?? 'all'}`, async () => {
      const cr = this.compareRange(r, compare);
      const current = await this.kpis(r, scope);
      const previous = cr ? await this.kpis(cr, scope) : null;
      const change: Record<string, number | null> = {};
      if (previous) for (const k of Object.keys(current)) change[k] = pctChange(current[k], previous[k] ?? 0);
      return { range: { from: r.from, to: r.to, days: r.days }, compareRange: cr ? { from: cr.from, to: cr.to } : null, current, previous, change };
    });
  }

  // ─────────────────────────── Time series ───────────────────────────

  async timeseries(r: Range, granularity: Granularity | undefined, scope: Scope, compare: Compare = 'none') {
    const g = granularity ?? autoGranularity(r.days);
    return this.cached(`ts:${r.from}:${r.to}:${g}:${compare}:${scope?.join(',') ?? 'all'}`, async () => {
      const series = await this.series(r, g, scope);
      const cr = this.compareRange(r, compare);
      // Comparison series aligned by position (bucket n of this period vs bucket n of the other).
      const prev = cr ? await this.series(cr, g, scope) : null;
      return {
        granularity: g,
        series: series.map((row, i) => ({ ...row, previousBookings: prev?.[i]?.bookings ?? null, previousGmv: prev?.[i]?.gmv ?? null })),
      };
    });
  }

  private async series(r: Range, g: Granularity, scope: Scope): Promise<Record<string, any>[]> {
    const keys = bucketKeys(r, g, this.tz);
    const p = [r.start, r.end, scope, g, this.tz];
    const bookings = await this.ds.query(
      `SELECT to_char(date_trunc($4, created_at AT TIME ZONE $5), 'YYYY-MM-DD') AS bucket,
              count(*) FILTER (WHERE kind = 'APPOINTMENT')::int AS appointments,
              count(*) FILTER (WHERE kind = 'LAB_ORDER')::int AS lab,
              count(*) FILTER (WHERE kind = 'RADIOLOGY_ORDER')::int AS radiology,
              count(*) FILTER (WHERE kind = 'PHARMACY_ORDER')::int AS pharmacy,
              count(*)::int AS bookings,
              count(*) FILTER (WHERE outcome = 'CANCELLED')::int AS cancelled
         FROM analytics_bookings
        WHERE created_at >= $1 AND created_at < $2 AND outcome <> 'RESCHEDULED' AND ($3::uuid[] IS NULL OR provider_id = ANY($3))
        GROUP BY 1`,
      p,
    );
    const money = await this.ds.query(
      `SELECT to_char(date_trunc($4, p.paid_at AT TIME ZONE $5), 'YYYY-MM-DD') AS bucket,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION'), 0)::float AS gmv,
              coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission,
              coalesce(sum(c.provider_amount - c.reversed_provider_amount), 0)::float AS net,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type = 'SUBSCRIPTION'), 0)::float AS subscriptions
         FROM payments p LEFT JOIN commissions c ON c.payment_id = p.id
        WHERE p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') AND p.paid_at >= $1 AND p.paid_at < $2
          AND ($3::uuid[] IS NULL OR p.provider_id = ANY($3))
        GROUP BY 1`,
      p,
    );
    const b = fillSeries(keys, bookings, { appointments: 0, lab: 0, radiology: 0, pharmacy: 0, bookings: 0, cancelled: 0 });
    const mm = fillSeries(keys, money, { gmv: 0, commission: 0, net: 0, subscriptions: 0 });
    return b.map((row, i) => ({ ...row, ...mm[i], platformRevenue: Math.round(((mm[i].commission as number) + (mm[i].subscriptions as number)) * 100) / 100 }));
  }

  // ─────────────────────────── Breakdowns ───────────────────────────

  async breakdowns(r: Range, scope: Scope) {
    return this.cached(`bd:${r.from}:${r.to}:${scope?.join(',') ?? 'all'}`, async () => {
      const p = [r.start, r.end, scope];
      const scopeSql = `created_at >= $1 AND created_at < $2 AND outcome <> 'RESCHEDULED' AND ($3::uuid[] IS NULL OR provider_id = ANY($3))`;
      const byKind = await this.ds.query(
        `SELECT kind AS key, count(*)::int AS bookings, count(*) FILTER (WHERE outcome = 'COMPLETED')::int AS completed,
                count(*) FILTER (WHERE outcome = 'CANCELLED')::int AS cancelled, coalesce(sum(amount) FILTER (WHERE outcome = 'COMPLETED'), 0)::float AS value
           FROM analytics_bookings WHERE ${scopeSql} GROUP BY kind ORDER BY bookings DESC`,
        p,
      );
      const byChannel = await this.ds.query(
        `SELECT kind, channel AS key, count(*)::int AS bookings FROM analytics_bookings WHERE ${scopeSql} GROUP BY kind, channel ORDER BY bookings DESC`,
        p,
      );
      const bySpecialty = await this.ds.query(
        `SELECT s.name_ar AS key, count(*)::int AS bookings, count(*) FILTER (WHERE b.outcome = 'COMPLETED')::int AS completed,
                coalesce(sum(b.amount) FILTER (WHERE b.outcome = 'COMPLETED'), 0)::float AS value
           FROM analytics_bookings b JOIN specialties s ON s.id = b.specialty_id
          WHERE b.kind = 'APPOINTMENT' AND b.created_at >= $1 AND b.created_at < $2 AND b.outcome <> 'RESCHEDULED' AND ($3::uuid[] IS NULL OR b.provider_id = ANY($3))
          GROUP BY s.name_ar ORDER BY bookings DESC LIMIT 15`,
        p,
      );
      const byGovernorate = await this.ds.query(
        `SELECT coalesce(g.name_ar, 'غير محدد') AS key, count(*)::int AS bookings, count(DISTINCT b.patient_id)::int AS patients
           FROM analytics_bookings b
           LEFT JOIN LATERAL (SELECT city_id FROM provider_branches pb WHERE pb.id = b.branch_id
                              UNION ALL SELECT city_id FROM provider_branches pb2 WHERE pb2.provider_id = b.provider_id AND b.branch_id IS NULL
                              LIMIT 1) br ON true
           LEFT JOIN cities c ON c.id = br.city_id LEFT JOIN governorates g ON g.id = c.governorate_id
          WHERE b.created_at >= $1 AND b.created_at < $2 AND b.outcome <> 'RESCHEDULED' AND ($3::uuid[] IS NULL OR b.provider_id = ANY($3))
          GROUP BY 1 ORDER BY bookings DESC`,
        p,
      );
      const byPaymentMethod = await this.ds.query(
        `SELECT method AS key, collected_by, count(*)::int AS payments, coalesce(sum(amount - refunded_amount), 0)::float AS value FROM payments
          WHERE status IN ('PAID', 'PARTIALLY_REFUNDED') AND entity_type <> 'SUBSCRIPTION' AND paid_at >= $1 AND paid_at < $2 AND ($3::uuid[] IS NULL OR provider_id = ANY($3))
          GROUP BY method, collected_by ORDER BY value DESC`,
        p,
      );
      // Busiest hours: weekday (0 = Sunday) × hour of the service time, clinic time zone.
      const heatmap = await this.ds.query(
        `SELECT extract(dow FROM service_at AT TIME ZONE $4)::int AS dow, extract(hour FROM service_at AT TIME ZONE $4)::int AS hour, count(*)::int AS n
           FROM analytics_bookings WHERE ${scopeSql} AND kind <> 'PHARMACY_ORDER' GROUP BY 1, 2`,
        [...p, this.tz],
      );
      const patients = await this.ds.query(
        `SELECT pa.gender, extract(year FROM age(pa.date_of_birth))::int AS age FROM patients pa
          WHERE pa.id IN (SELECT DISTINCT patient_id FROM analytics_bookings WHERE ${scopeSql})`,
        p,
      );
      const gender: Record<string, number> = {};
      const ages: Record<string, number> = {};
      for (const x of patients) {
        gender[x.gender ?? 'unknown'] = (gender[x.gender ?? 'unknown'] ?? 0) + 1;
        const k = ageGroup(x.age);
        ages[k] = (ages[k] ?? 0) + 1;
      }
      return {
        byKind,
        byChannel,
        bySpecialty,
        byGovernorate,
        byPaymentMethod,
        heatmap,
        patients: { total: patients.length, gender, ageGroups: ages },
        topItems: scope ? await this.topItems(r, scope) : [],
      };
    });
  }

  /** What each provider sells most: lab tests/packages, radiology exams, medicines, appointment types. */
  private async topItems(r: Range, scope: string[]) {
    const p = [r.start, r.end, scope];
    return this.ds.query(
      `SELECT * FROM (
         SELECT coalesce(t.name, pk.name) AS name, count(*)::int AS qty, coalesce(sum(i.price), 0)::float AS value
           FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN laboratories l ON l.id = o.laboratory_id
           LEFT JOIN lab_tests t ON t.id = i.test_id LEFT JOIN lab_packages pk ON pk.id = i.package_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'CANCELLED' AND l.provider_id = ANY($3) GROUP BY 1
         UNION ALL
         SELECT s.name, count(*)::int, coalesce(sum(o.price - o.discount), 0)::float
           FROM radiology_orders o JOIN radiology_services s ON s.id = o.service_id JOIN radiology_centers c ON c.id = o.center_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status NOT IN ('CANCELLED', 'NO_SHOW') AND c.provider_id = ANY($3) GROUP BY 1
         UNION ALL
         SELECT i.medicine_name, sum(i.quantity)::int, coalesce(sum(i.quantity * i.unit_price), 0)::float
           FROM pharmacy_order_items i JOIN pharmacy_orders o ON o.id = i.order_id JOIN pharmacies ph ON ph.id = o.pharmacy_id
          WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'CANCELLED' AND ph.provider_id = ANY($3) GROUP BY 1
       ) x ORDER BY value DESC LIMIT 10`,
      p,
    );
  }

  // ─────────────────────────── Funnel & cohorts ───────────────────────────

  async funnel(r: Range, scope: Scope) {
    return this.cached(`funnel:${r.from}:${r.to}:${scope?.join(',') ?? 'all'}`, async () => {
      const [a] = await this.ds.query(
        `SELECT count(*) FILTER (WHERE a.status <> 'RESCHEDULED')::int AS booked,
                count(*) FILTER (WHERE a.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'))::int AS confirmed,
                count(*) FILTER (WHERE a.status IN ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'))::int AS attended,
                count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
                count(r.id)::int AS reviewed
           FROM appointments a LEFT JOIN reviews r ON r.appointment_id = a.id
          WHERE a.created_at >= $1 AND a.created_at < $2 AND ($3::uuid[] IS NULL OR a.provider_id = ANY($3))`,
        [r.start, r.end, scope],
      );
      const [o] = await this.ds.query(
        `SELECT count(*) FILTER (WHERE outcome <> 'RESCHEDULED')::int AS booked,
                count(*) FILTER (WHERE payment_status IN ('PAID', 'PARTIALLY_REFUNDED'))::int AS paid,
                count(*) FILTER (WHERE outcome = 'COMPLETED')::int AS completed
           FROM analytics_bookings WHERE kind <> 'APPOINTMENT' AND created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR provider_id = ANY($3))`,
        [r.start, r.end, scope],
      );
      const steps = (rows: [string, string, number][]) => rows.map(([key, label, n], i) => ({ key, label, count: n, pctOfFirst: ratio(n, rows[0][2]), pctOfPrevious: i ? ratio(n, rows[i - 1][2]) : 100 }));
      return {
        appointments: steps([
          ['booked', 'حجز', a.booked],
          ['confirmed', 'تأكيد', a.confirmed],
          ['attended', 'حضور', a.attended],
          ['completed', 'اكتمال الكشف', a.completed],
          ['reviewed', 'تقييم', a.reviewed],
        ]),
        orders: steps([
          ['booked', 'طلب', o.booked],
          ['paid', 'دفع', o.paid],
          ['completed', 'تسليم / نتيجة', o.completed],
        ]),
      };
    });
  }

  async cohorts(scope: Scope, months = 6) {
    return this.cached(`cohorts:${months}:${scope?.join(',') ?? 'all'}`, async () => {
      const rows = await this.ds.query(
        `WITH b AS (
           SELECT patient_id, date_trunc('month', created_at AT TIME ZONE $2)::date AS month
             FROM analytics_bookings WHERE outcome <> 'RESCHEDULED' AND ($1::uuid[] IS NULL OR provider_id = ANY($1))
         ), first AS (SELECT patient_id, min(month) AS cohort FROM b GROUP BY patient_id)
         SELECT to_char(f.cohort, 'YYYY-MM-DD') AS cohort, to_char(b.month, 'YYYY-MM-DD') AS month, count(DISTINCT b.patient_id)::int AS patients
           FROM b JOIN first f ON f.patient_id = b.patient_id
          WHERE f.cohort >= date_trunc('month', now() AT TIME ZONE $2)::date - make_interval(months => $3::int - 1)
          GROUP BY 1, 2`,
        [scope, this.tz, months],
      );
      return { months, cohorts: buildCohorts(rows, Math.min(5, months - 1)) };
    });
  }

  // ─────────────────────────── Providers leaderboard ───────────────────────────

  async leaderboard(r: Range, q: { type?: string; search?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; pageSize?: number }) {
    const sort = LEADERBOARD_SORTS[q.sort ?? 'gmv'] ?? 'gmv';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const params: unknown[] = [r.start, r.end];
    const where: string[] = [`pr.verification_status = 'APPROVED'`];
    if (q.type) {
      params.push(q.type);
      where.push(`pr.type = $${params.length}`);
    }
    if (q.search?.trim()) {
      params.push(`%${likeEscape(q.search.trim())}%`);
      where.push(`pr.name_ar ILIKE $${params.length}`);
    }
    const page = Math.max(1, q.page ?? 1);
    const size = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const base = `
      WITH b AS (
        SELECT provider_id, count(*) FILTER (WHERE outcome <> 'RESCHEDULED')::int AS bookings,
               count(*) FILTER (WHERE outcome = 'COMPLETED')::int AS completed,
               count(*) FILTER (WHERE outcome = 'CANCELLED')::int AS cancelled,
               count(*) FILTER (WHERE outcome = 'NO_SHOW')::int AS no_show,
               count(DISTINCT patient_id)::int AS patients
          FROM analytics_bookings WHERE created_at >= $1 AND created_at < $2 GROUP BY provider_id
      ), m AS (
        SELECT p.provider_id, coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gmv, coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission
          FROM payments p LEFT JOIN commissions c ON c.payment_id = p.id
         WHERE p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') AND p.entity_type <> 'SUBSCRIPTION' AND p.paid_at >= $1 AND p.paid_at < $2
         GROUP BY p.provider_id
      ), rv AS (
        SELECT provider_id, avg(rating)::float AS rating, count(*)::int AS reviews FROM reviews WHERE status = 'PUBLISHED' GROUP BY provider_id
      )
      SELECT pr.id, pr.name_ar, pr.type, pr.slug, pr.subscription_active,
             coalesce(b.bookings, 0) AS bookings, coalesce(b.completed, 0) AS completed, coalesce(b.cancelled, 0) AS cancelled,
             coalesce(b.no_show, 0) AS no_show, coalesce(b.patients, 0) AS patients,
             coalesce(m.gmv, 0) AS gmv, coalesce(m.commission, 0) AS commission,
             round(coalesce(rv.rating, 0)::numeric, 1)::float AS rating, coalesce(rv.reviews, 0) AS reviews,
             CASE WHEN coalesce(b.completed + b.cancelled + b.no_show, 0) = 0 THEN 0 ELSE round(100.0 * b.completed / (b.completed + b.cancelled + b.no_show), 1)::float END AS completion_rate,
             CASE WHEN coalesce(b.bookings, 0) = 0 THEN 0 ELSE round(100.0 * b.cancelled / b.bookings, 1)::float END AS cancellation_rate
        FROM providers pr LEFT JOIN b ON b.provider_id = pr.id LEFT JOIN m ON m.provider_id = pr.id LEFT JOIN rv ON rv.provider_id = pr.id
       WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (${base}) x`, params);
    const rows = await this.ds.query(`${base} ORDER BY ${sort} ${dir} NULLS LAST, pr.name_ar LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    return {
      items: rows.map((x: any) => ({
        providerId: x.id,
        nameAr: x.name_ar,
        type: x.type,
        slug: x.slug,
        subscriptionActive: x.subscription_active,
        bookings: x.bookings,
        completed: x.completed,
        cancelled: x.cancelled,
        noShow: x.no_show,
        patients: x.patients,
        gmv: x.gmv,
        commission: x.commission,
        rating: x.rating,
        reviews: x.reviews,
        completionRate: x.completion_rate,
        cancellationRate: x.cancellation_rate,
      })),
      total,
      page,
      pageSize: size,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

}
