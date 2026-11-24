import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth-user';
import { LabCatalogService } from './lab-catalog.service';
import { LabOrdersService } from './lab-orders.service';

/** Lab dashboard + reports (spec §29). All figures are computed in SQL for the caller's own laboratory only. */
@Injectable()
export class LabDashboardService {
  constructor(
    private ds: DataSource,
    private catalog: LabCatalogService,
    private orders: LabOrdersService,
  ) {}

  async dashboard(user: AuthUser, fromIso?: string, toIso?: string) {
    const { lab } = await this.catalog.myLab(user);
    const tz = this.orders.tz;
    const now = DateTime.now().setZone(tz);
    const from = fromIso ? DateTime.fromISO(fromIso, { zone: tz }).startOf('day') : now.minus({ days: 29 }).startOf('day');
    const to = toIso ? DateTime.fromISO(toIso, { zone: tz }).endOf('day') : now.endOf('day');
    const dayStart = now.startOf('day').toJSDate();
    const dayEnd = now.endOf('day').toJSDate();
    const f = from.toJSDate();
    const t = to.toJSDate();
    const id = lab.id;

    const [today] = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE scheduled_at BETWEEN $2 AND $3 AND status <> 'CANCELLED')::int AS today_orders,
         count(*) FILTER (WHERE status IN ('NEW_ORDER','PAID') AND scheduled_at <= $3)::int AS pending_samples,
         count(*) FILTER (WHERE status IN ('SAMPLE_COLLECTED','SAMPLE_RECEIVED','PROCESSING'))::int AS processing,
         count(*) FILTER (WHERE status IN ('RESULT_ENTERED','UNDER_REVIEW'))::int AS awaiting_approval,
         count(*) FILTER (WHERE status IN ('NEW_ORDER','PAID') AND home_collection AND scheduled_at >= $2)::int AS home_requests
       FROM lab_orders WHERE laboratory_id = $1`,
      [id, dayStart, dayEnd],
    );
    const [done] = await this.ds.query(
      `SELECT count(*)::int AS completed_today FROM lab_results r JOIN lab_orders o ON o.id = r.order_id
        WHERE o.laboratory_id = $1 AND r.approved_at BETWEEN $2 AND $3`,
      [id, dayStart, dayEnd],
    );
    const [range] = await this.ds.query(
      `SELECT
         count(*) FILTER (WHERE o.status <> 'CANCELLED')::int AS orders,
         count(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
         count(DISTINCT o.patient_id) FILTER (WHERE o.status <> 'CANCELLED')::int AS patients,
         coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'PAID'), 0)::float AS revenue,
         count(*) FILTER (WHERE o.home_collection AND o.status <> 'CANCELLED')::int AS home_orders,
         count(*) FILTER (WHERE r.critical_count > 0 AND r.approved_at IS NOT NULL)::int AS critical_results,
         count(*) FILTER (WHERE o.status IN ('SAMPLE_COLLECTED','SAMPLE_RECEIVED','PROCESSING','RESULT_ENTERED','UNDER_REVIEW'))::int AS pending_results
       FROM lab_orders o LEFT JOIN lab_results r ON r.order_id = o.id
       WHERE o.laboratory_id = $1 AND o.created_at BETWEEN $2 AND $3`,
      [id, f, t],
    );
    const [tat] = await this.ds.query(
      `SELECT avg(extract(epoch FROM (r.approved_at - s.first_collected)) / 3600)::float AS avg_hours
         FROM lab_results r JOIN lab_orders o ON o.id = r.order_id
         JOIN LATERAL (SELECT min(collected_at) AS first_collected FROM lab_samples WHERE order_id = o.id AND rejected_at IS NULL) s ON true
        WHERE o.laboratory_id = $1 AND r.approved_at BETWEEN $2 AND $3 AND s.first_collected IS NOT NULL`,
      [id, f, t],
    );
    // Most requested tests counts tests ordered directly AND inside packages.
    const topTests = await this.ds.query(
      `WITH lines AS (
         SELECT i.test_id, i.price::float AS revenue FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id
          WHERE o.laboratory_id = $1 AND o.status <> 'CANCELLED' AND o.created_at BETWEEN $2 AND $3 AND i.test_id IS NOT NULL
         UNION ALL
         SELECT pi.test_id, 0 FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN lab_package_items pi ON pi.package_id = i.package_id
          WHERE o.laboratory_id = $1 AND o.status <> 'CANCELLED' AND o.created_at BETWEEN $2 AND $3)
       SELECT t.code, t.name, count(*)::int AS count, sum(l.revenue)::float AS revenue
         FROM lines l JOIN lab_tests t ON t.id = l.test_id GROUP BY t.code, t.name ORDER BY count(*) DESC LIMIT 10`,
      [id, f, t],
    );
    const byPackage = await this.ds.query(
      `SELECT pk.name, count(*)::int AS count, sum(i.price)::float AS revenue
         FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN lab_packages pk ON pk.id = i.package_id
        WHERE o.laboratory_id = $1 AND o.status <> 'CANCELLED' AND o.created_at BETWEEN $2 AND $3
        GROUP BY pk.name ORDER BY sum(i.price) DESC LIMIT 10`,
      [id, f, t],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM lab_orders o WHERE o.laboratory_id = $1 AND o.status <> 'CANCELLED'
                 AND (o.created_at AT TIME ZONE $4)::date = d::date)::int AS orders,
              (SELECT coalesce(sum(o.total), 0) FROM lab_orders o WHERE o.laboratory_id = $1 AND o.payment_status = 'PAID'
                 AND (o.paid_at AT TIME ZONE $4)::date = d::date)::float AS revenue
         FROM generate_series(($2::timestamptz AT TIME ZONE $4)::date, ($3::timestamptz AT TIME ZONE $4)::date, interval '1 day') d`,
      [id, f, t, tz],
    );
    const statusSplit = await this.ds.query(
      `SELECT status, count(*)::int AS count FROM lab_orders WHERE laboratory_id = $1 AND created_at BETWEEN $2 AND $3 GROUP BY status`,
      [id, f, t],
    );
    return {
      range: { from: from.toISODate(), to: to.toISODate() },
      today: {
        orders: today.today_orders,
        pendingSamples: today.pending_samples,
        processing: today.processing,
        awaitingApproval: today.awaiting_approval,
        homeRequests: today.home_requests,
        completedToday: done.completed_today,
      },
      totals: {
        orders: range.orders,
        cancelled: range.cancelled,
        patients: range.patients,
        revenue: range.revenue,
        homeOrders: range.home_orders,
        criticalResults: range.critical_results,
        pendingResults: range.pending_results,
        avgTurnaroundHours: tat?.avg_hours ? Math.round(tat.avg_hours * 10) / 10 : null,
      },
      topTests,
      revenueByPackage: byPackage,
      daily,
      statusSplit,
    };
  }
}
