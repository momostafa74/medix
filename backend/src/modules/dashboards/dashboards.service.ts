import { ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { CommissionRule, ProviderType } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { calculateCommission, pickRule } from '../../common/utils/commission';
import { AvailabilityService } from '../schedules/availability.service';

export interface Range {
  from: Date;
  to: Date;
}

@Injectable()
export class DashboardsService {
  constructor(
    private ds: DataSource,
    private availability: AvailabilityService,
  ) {}

  get tz() {
    return this.availability.tz;
  }

  /** Default range: last 30 days ending today (local). */
  range(from?: string, to?: string): Range {
    const end = to ? DateTime.fromISO(to, { zone: this.tz }).endOf('day') : DateTime.now().setZone(this.tz).endOf('day');
    const start = from ? DateTime.fromISO(from, { zone: this.tz }).startOf('day') : end.minus({ days: 29 }).startOf('day');
    return { from: start.toJSDate(), to: end.toJSDate() };
  }

  private today() {
    const d = DateTime.now().setZone(this.tz);
    return { from: d.startOf('day').toJSDate(), to: d.endOf('day').toJSDate() };
  }

  // ─────────────── Admin ───────────────

  async admin(r: Range) {
    const t = this.today();
    const q = (sql: string, p: unknown[] = []) => this.ds.query(sql, p).then((rows) => rows[0]);

    const [counts, providers, appts, revenue, refunds, regs] = await Promise.all([
      q(`SELECT
           (SELECT count(*) FROM patients)::int AS patients,
           (SELECT count(*) FROM providers WHERE type='DOCTOR' AND verification_status='APPROVED')::int AS doctors,
           (SELECT count(*) FROM providers WHERE type='LABORATORY' AND verification_status='APPROVED')::int AS laboratories,
           (SELECT count(*) FROM providers WHERE type='RADIOLOGY' AND verification_status='APPROVED')::int AS radiology,
           (SELECT count(*) FROM providers WHERE type='PHARMACY' AND verification_status='APPROVED')::int AS pharmacies`),
      q(`SELECT count(*) FILTER (WHERE verification_status='APPROVED' AND is_active)::int AS active,
                count(*) FILTER (WHERE verification_status='PENDING')::int AS pending,
                count(*) FILTER (WHERE verification_status='SUSPENDED')::int AS suspended
           FROM providers`),
      q(
        `SELECT count(*) FILTER (WHERE start_at BETWEEN $3 AND $4 AND status NOT IN ('CANCELLED','RESCHEDULED'))::int AS today,
                count(*) FILTER (WHERE start_at BETWEEN $1 AND $2)::int AS total,
                count(*) FILTER (WHERE start_at BETWEEN $1 AND $2 AND status='COMPLETED')::int AS completed,
                count(*) FILTER (WHERE start_at BETWEEN $1 AND $2 AND status='CANCELLED')::int AS cancelled,
                count(*) FILTER (WHERE start_at BETWEEN $1 AND $2 AND status='NO_SHOW')::int AS no_show
           FROM appointments`,
        [r.from, r.to, t.from, t.to],
      ),
      q(`SELECT COALESCE(sum(final_price),0)::float AS revenue FROM appointments
          WHERE status='COMPLETED' AND payment_status='PAID' AND start_at BETWEEN $1 AND $2`, [r.from, r.to]),
      q(`SELECT COALESCE(sum(amount),0)::float AS refunds FROM refunds WHERE created_at BETWEEN $1 AND $2`, [r.from, r.to]),
      q(`SELECT count(*)::int AS new_users,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM patients p WHERE p.user_id = u.id))::int AS new_patients
           FROM users u WHERE created_at BETWEEN $1 AND $2`, [r.from, r.to]),
    ]);

    const commission = await this.estimateCommission(r);

    const [byDay, byType, topSpecialties, patientGrowth, providerGrowth, statusSplit] = await Promise.all([
      this.ds.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                COALESCE(count(a.id) FILTER (WHERE a.status NOT IN ('CANCELLED','RESCHEDULED')),0)::int AS appointments,
                COALESCE(sum(a.final_price) FILTER (WHERE a.status='COMPLETED' AND a.payment_status='PAID'),0)::float AS revenue
           FROM generate_series(($1::timestamptz AT TIME ZONE $3)::date, ($2::timestamptz AT TIME ZONE $3)::date, interval '1 day') d
           LEFT JOIN appointments a ON (a.start_at AT TIME ZONE $3)::date = d::date
          GROUP BY d ORDER BY d`,
        [r.from, r.to, this.tz],
      ),
      this.ds.query(`SELECT type, count(*)::int AS count FROM providers WHERE verification_status='APPROVED' GROUP BY type ORDER BY count DESC`),
      this.ds.query(
        `SELECT s.name_ar AS name, count(a.id)::int AS count
           FROM appointments a JOIN specialties s ON s.id = a.specialty_id
          WHERE a.start_at BETWEEN $1 AND $2 AND a.status NOT IN ('CANCELLED','RESCHEDULED')
          GROUP BY s.name_ar ORDER BY count DESC LIMIT 8`,
        [r.from, r.to],
      ),
      this.growth('patients'),
      this.growth('providers'),
      this.ds.query(
        `SELECT status, count(*)::int AS count FROM appointments WHERE start_at BETWEEN $1 AND $2 GROUP BY status ORDER BY count DESC`,
        [r.from, r.to],
      ),
    ]);

    return {
      range: r,
      stats: {
        ...counts,
        activeProviders: providers.active,
        pendingApprovals: providers.pending,
        suspendedProviders: providers.suspended,
        todayAppointments: appts.today,
        appointments: appts.total,
        completedAppointments: appts.completed,
        cancelledAppointments: appts.cancelled,
        noShows: appts.no_show,
        revenue: revenue.revenue,
        platformCommission: commission,
        refunds: refunds.refunds,
        newRegistrations: regs.new_users,
        newPatients: regs.new_patients,
      },
      charts: { byDay, providersByType: byType, topSpecialties, patientGrowth, providerGrowth, statusSplit },
    };
  }

  /** Monthly growth for the last 12 months (new + cumulative). */
  private growth(table: 'patients' | 'providers') {
    return this.ds.query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              (SELECT count(*) FROM ${table} x WHERE date_trunc('month', x.created_at AT TIME ZONE $1) = m)::int AS new,
              (SELECT count(*) FROM ${table} x WHERE x.created_at AT TIME ZONE $1 < m + interval '1 month')::int AS total
         FROM generate_series(date_trunc('month', now() AT TIME ZONE $1) - interval '11 months',
                              date_trunc('month', now() AT TIME ZONE $1), interval '1 month') m
        ORDER BY m`,
      [this.tz],
    );
  }

  /** Commission on completed+paid appointments using the active commission rules (snapshot rows arrive with Phase 7 payments). */
  private async estimateCommission(r: Range) {
    const rules = await this.ds.getRepository(CommissionRule).find({ where: { isActive: true } });
    if (!rules.length) return 0;
    const rows: { provider_id: string; type: ProviderType; gross: number }[] = await this.ds.query(
      `SELECT a.provider_id, p.type, sum(a.final_price)::float AS gross
         FROM appointments a JOIN providers p ON p.id = a.provider_id
        WHERE a.status='COMPLETED' AND a.payment_status='PAID' AND a.start_at BETWEEN $1 AND $2
        GROUP BY a.provider_id, p.type`,
      [r.from, r.to],
    );
    return rows.reduce((sum, row) => sum + calculateCommission(row.gross, pickRule(rules, row.provider_id, row.type)).commission, 0);
  }

  // ─────────────── Doctor / provider ───────────────

  async doctor(user: AuthUser, r: Range) {
    if (!user.providerIds.length) throw new ForbiddenException('غير مصرح');
    const ids = user.providerIds;
    const t = this.today();

    const [summary] = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE start_at BETWEEN $4 AND $5 AND status NOT IN ('CANCELLED','RESCHEDULED'))::int AS today,
         count(*) FILTER (WHERE start_at > now() AND status IN ('PENDING','CONFIRMED'))::int AS upcoming,
         count(*) FILTER (WHERE status = 'PENDING' AND start_at > now())::int AS awaiting_confirmation,
         count(*) FILTER (WHERE start_at BETWEEN $2 AND $3 AND status NOT IN ('RESCHEDULED'))::int AS total,
         count(*) FILTER (WHERE start_at BETWEEN $2 AND $3 AND status='COMPLETED')::int AS completed,
         count(*) FILTER (WHERE start_at BETWEEN $2 AND $3 AND status='CANCELLED')::int AS cancelled,
         count(*) FILTER (WHERE start_at BETWEEN $2 AND $3 AND status='NO_SHOW')::int AS no_show,
         COALESCE(sum(final_price) FILTER (WHERE start_at BETWEEN $2 AND $3 AND status='COMPLETED' AND payment_status='PAID'),0)::float AS revenue,
         count(DISTINCT patient_id) FILTER (WHERE status <> 'CANCELLED')::int AS total_patients
       FROM appointments WHERE provider_id = ANY($1::uuid[])`,
      [ids, r.from, r.to, t.from, t.to],
    );
    const [patients] = await this.ds.query(
      `WITH firsts AS (
         SELECT patient_id, min(start_at) AS first_at FROM appointments
          WHERE provider_id = ANY($1::uuid[]) AND status NOT IN ('CANCELLED','RESCHEDULED') GROUP BY patient_id)
       SELECT count(*) FILTER (WHERE f.first_at BETWEEN $2 AND $3)::int AS new_patients,
              count(*) FILTER (WHERE f.first_at < $2 AND EXISTS (
                 SELECT 1 FROM appointments a WHERE a.patient_id = f.patient_id AND a.provider_id = ANY($1::uuid[])
                    AND a.start_at BETWEEN $2 AND $3 AND a.status NOT IN ('CANCELLED','RESCHEDULED')))::int AS returning_patients
         FROM firsts f`,
      [ids, r.from, r.to],
    );
    const [rating] = await this.ds.query(
      `SELECT COALESCE(avg(rating_avg),0)::float AS avg, COALESCE(sum(rating_count),0)::int AS count FROM providers WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const [byDay, popularHours, monthly, todayList, recentReviews] = await Promise.all([
      this.ds.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                count(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
                count(a.id) FILTER (WHERE a.status IN ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS'))::int AS scheduled,
                count(a.id) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
                count(a.id) FILTER (WHERE a.status = 'NO_SHOW')::int AS no_show,
                COALESCE(sum(a.final_price) FILTER (WHERE a.status='COMPLETED' AND a.payment_status='PAID'),0)::float AS revenue
           FROM generate_series(($2::timestamptz AT TIME ZONE $4)::date, ($3::timestamptz AT TIME ZONE $4)::date, interval '1 day') d
           LEFT JOIN appointments a ON (a.start_at AT TIME ZONE $4)::date = d::date AND a.provider_id = ANY($1::uuid[])
          GROUP BY d ORDER BY d`,
        [ids, r.from, r.to, this.tz],
      ),
      this.ds.query(
        `SELECT extract(hour FROM start_at AT TIME ZONE $4)::int AS hour, count(*)::int AS count
           FROM appointments WHERE provider_id = ANY($1::uuid[]) AND start_at BETWEEN $2 AND $3
            AND status NOT IN ('CANCELLED','RESCHEDULED')
          GROUP BY hour ORDER BY hour`,
        [ids, r.from, r.to, this.tz],
      ),
      this.ds.query(
        `SELECT to_char(date_trunc('month', start_at AT TIME ZONE $2), 'YYYY-MM') AS month,
                count(*) FILTER (WHERE status NOT IN ('CANCELLED','RESCHEDULED'))::int AS appointments,
                COALESCE(sum(final_price) FILTER (WHERE status='COMPLETED' AND payment_status='PAID'),0)::float AS revenue
           FROM appointments WHERE provider_id = ANY($1::uuid[]) AND start_at > now() - interval '12 months'
          GROUP BY 1 ORDER BY 1`,
        [ids, this.tz],
      ),
      this.ds.query(
        `SELECT a.id, a.code, a.start_at AS "startAt", a.status, a.type, u.full_name AS "patientName", u.phone AS "patientPhone"
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = p.user_id
          WHERE a.provider_id = ANY($1::uuid[]) AND a.start_at BETWEEN $2 AND $3 AND a.status NOT IN ('CANCELLED','RESCHEDULED')
          ORDER BY a.start_at`,
        [ids, t.from, t.to],
      ),
      this.ds.query(
        `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt", split_part(u.full_name, ' ', 1) AS "patientName"
           FROM reviews r JOIN patients p ON p.id = r.patient_id JOIN users u ON u.id = p.user_id
          WHERE r.provider_id = ANY($1::uuid[]) AND r.status = 'PUBLISHED' ORDER BY r.created_at DESC LIMIT 5`,
        [ids],
      ),
    ]);
    const decided = summary.completed + summary.no_show;
    return {
      range: r,
      stats: {
        todayAppointments: summary.today,
        upcomingAppointments: summary.upcoming,
        awaitingConfirmation: summary.awaiting_confirmation,
        appointments: summary.total,
        completedAppointments: summary.completed,
        cancelledAppointments: summary.cancelled,
        noShows: summary.no_show,
        revenue: summary.revenue,
        totalPatients: summary.total_patients,
        newPatients: patients.new_patients,
        returningPatients: patients.returning_patients,
        cancellationRate: summary.total ? +(summary.cancelled / summary.total * 100).toFixed(1) : 0,
        noShowRate: decided ? +(summary.no_show / decided * 100).toFixed(1) : 0,
        rating: +Number(rating.avg).toFixed(2),
        reviewsCount: rating.count,
      },
      charts: { byDay, popularHours, monthly },
      today: todayList,
      recentReviews,
    };
  }

  // ─────────────── Patient ───────────────

  async patient(user: AuthUser) {
    if (!user.patientId) throw new ForbiddenException('غير مصرح');
    const [s] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE start_at > now() AND status IN ('PENDING','CONFIRMED'))::int AS upcoming,
              count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              (SELECT count(*) FROM favorites WHERE patient_id = $1)::int AS favorites,
              (SELECT count(*) FROM notifications n WHERE n.user_id = $2 AND n.read_at IS NULL)::int AS unread
         FROM appointments WHERE patient_id = $1`,
      [user.patientId, user.id],
    );
    const next = await this.ds.query(
      `SELECT a.id, a.code, a.start_at AS "startAt", a.status, a.type, pr.name_ar AS "providerName", b.name AS "branchName", b.address
         FROM appointments a JOIN providers pr ON pr.id = a.provider_id LEFT JOIN provider_branches b ON b.id = a.branch_id
        WHERE a.patient_id = $1 AND a.start_at > now() AND a.status IN ('PENDING','CONFIRMED')
        ORDER BY a.start_at LIMIT 3`,
      [user.patientId],
    );
    const toReview = await this.ds.query(
      `SELECT a.id, a.code, a.start_at AS "startAt", pr.name_ar AS "providerName"
         FROM appointments a JOIN providers pr ON pr.id = a.provider_id
        WHERE a.patient_id = $1 AND a.status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = a.id)
        ORDER BY a.start_at DESC LIMIT 3`,
      [user.patientId],
    );
    return { stats: s, upcoming: next, toReview };
  }

  // ─────────────── CSV export ───────────────

  async appointmentsCsv(user: AuthUser, r: Range, all: boolean) {
    const params: unknown[] = [r.from, r.to, this.tz];
    let scope = '';
    if (!all) {
      if (!user.providerIds.length) throw new ForbiddenException('غير مصرح');
      params.push(user.providerIds);
      scope = `AND a.provider_id = ANY($4::uuid[])`;
    }
    const rows: Record<string, unknown>[] = await this.ds.query(
      `SELECT a.code AS "رقم الحجز",
              to_char(a.start_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS "الموعد",
              u.full_name AS "المريض", u.phone AS "الهاتف", pr.name_ar AS "مقدم الخدمة",
              a.type AS "النوع", a.status AS "الحالة", a.final_price AS "السعر", a.payment_status AS "الدفع"
         FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = p.user_id
         JOIN providers pr ON pr.id = a.provider_id
        WHERE a.start_at BETWEEN $1 AND $2 ${scope}
        ORDER BY a.start_at LIMIT 50000`,
      params,
    );
    return toCsv(rows);
  }
}

/** RFC 4180 CSV with UTF-8 BOM (Excel opens Arabic correctly). Formula-injection safe. */
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '﻿';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}
