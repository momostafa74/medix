import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { CommissionRule, CommissionScope, ProviderSettlement } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { providerBalance } from './payments-logic';
import { BalancesQuery, CommissionRuleDto, SettlementDto } from './payments.dto';

const R = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Net money per provider: online collections owed to them vs cash commission they owe. */
const BALANCE_SQL = `
  SELECT pr.id, pr.name_ar, pr.type, pr.slug,
    coalesce((SELECT sum(c.provider_amount - c.reversed_provider_amount) FROM commissions c JOIN payments p ON p.id = c.payment_id
               WHERE p.provider_id = pr.id AND p.collected_by = 'PLATFORM' AND p.entity_type <> 'SUBSCRIPTION'), 0)::float AS online_net,
    coalesce((SELECT sum(c.commission_amount - c.reversed_commission) FROM commissions c JOIN payments p ON p.id = c.payment_id
               WHERE p.provider_id = pr.id AND p.collected_by = 'PROVIDER'), 0)::float AS cash_commission,
    coalesce((SELECT sum(amount) FROM provider_settlements s WHERE s.provider_id = pr.id AND s.direction = 'TO_PROVIDER'), 0)::float AS paid_to_provider,
    coalesce((SELECT sum(amount) FROM provider_settlements s WHERE s.provider_id = pr.id AND s.direction = 'TO_PLATFORM'), 0)::float AS paid_to_platform
  FROM providers pr`;

@Injectable()
export class FinanceService {
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {
    this.tz = config.get<string>('timezone')!;
  }

  private range(fromIso?: string, toIso?: string) {
    const now = DateTime.now().setZone(this.tz);
    const from = (fromIso ? DateTime.fromISO(fromIso, { zone: this.tz }) : now.minus({ days: 29 })).startOf('day').toJSDate();
    const to = (toIso ? DateTime.fromISO(toIso, { zone: this.tz }) : now).endOf('day').toJSDate();
    if (from > to) throw new BadRequestException('الفترة غير صحيحة');
    return { from, to };
  }

  private balanceRow(r: any) {
    return {
      providerId: r.id,
      nameAr: r.name_ar,
      type: r.type,
      slug: r.slug,
      onlineNet: R(r.online_net),
      cashCommission: R(r.cash_commission),
      paidToProvider: R(r.paid_to_provider),
      paidToPlatform: R(r.paid_to_platform),
      balance: providerBalance({ onlineNet: r.online_net, cashCommission: r.cash_commission, paidToProvider: r.paid_to_provider, paidToPlatform: r.paid_to_platform }),
    };
  }

  // ─────────────── Platform dashboard ───────────────

  async adminDashboard(fromIso?: string, toIso?: string) {
    const { from, to } = this.range(fromIso, toIso);
    const [t] = await this.ds.query(
      `SELECT
         coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION'), 0)::float AS services_gross,
         coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION' AND p.collected_by = 'PLATFORM'), 0)::float AS online_gross,
         coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION' AND p.collected_by = 'PROVIDER'), 0)::float AS desk_gross,
         coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.entity_type = 'SUBSCRIPTION'), 0)::float AS subscriptions,
         coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission,
         count(*) FILTER (WHERE p.entity_type <> 'SUBSCRIPTION')::int AS payments
       FROM payments p LEFT JOIN commissions c ON c.payment_id = p.id
      WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND p.paid_at BETWEEN $1 AND $2`,
      [from, to],
    );
    const [rf] = await this.ds.query(`SELECT coalesce(sum(amount), 0)::float AS refunds, count(*)::int AS n FROM refunds WHERE status = 'COMPLETED' AND created_at BETWEEN $1 AND $2`, [from, to]);
    const [failed] = await this.ds.query(`SELECT count(*)::int AS n FROM payments WHERE status = 'FAILED' AND created_at BETWEEN $1 AND $2`, [from, to]);
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              coalesce((SELECT sum(p.amount - p.refunded_amount) FROM payments p WHERE p.status IN ('PAID','PARTIALLY_REFUNDED') AND p.entity_type <> 'SUBSCRIPTION' AND (p.paid_at AT TIME ZONE $3)::date = d::date), 0)::float AS gross,
              coalesce((SELECT sum(c.commission_amount - c.reversed_commission) FROM commissions c JOIN payments p ON p.id = c.payment_id WHERE (p.paid_at AT TIME ZONE $3)::date = d::date), 0)::float AS commission,
              coalesce((SELECT sum(p.amount - p.refunded_amount) FROM payments p WHERE p.status IN ('PAID','PARTIALLY_REFUNDED') AND p.entity_type = 'SUBSCRIPTION' AND (p.paid_at AT TIME ZONE $3)::date = d::date), 0)::float AS subscriptions
         FROM generate_series(($1::timestamptz AT TIME ZONE $3)::date, ($2::timestamptz AT TIME ZONE $3)::date, interval '1 day') d`,
      [from, to, this.tz],
    );
    const byType = await this.ds.query(
      `SELECT pr.type, coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gross, coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission, count(*)::int AS count
         FROM payments p JOIN providers pr ON pr.id = p.provider_id LEFT JOIN commissions c ON c.payment_id = p.id
        WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND p.entity_type <> 'SUBSCRIPTION' AND p.paid_at BETWEEN $1 AND $2
        GROUP BY pr.type ORDER BY gross DESC`,
      [from, to],
    );
    const byService = await this.ds.query(
      `SELECT p.entity_type, count(*)::int AS count, coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gross
         FROM payments p WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND p.paid_at BETWEEN $1 AND $2 GROUP BY p.entity_type ORDER BY gross DESC`,
      [from, to],
    );
    const topProviders = await this.ds.query(
      `SELECT pr.name_ar, pr.type, coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gross, coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission
         FROM payments p JOIN providers pr ON pr.id = p.provider_id LEFT JOIN commissions c ON c.payment_id = p.id
        WHERE p.status IN ('PAID','PARTIALLY_REFUNDED') AND p.entity_type <> 'SUBSCRIPTION' AND p.paid_at BETWEEN $1 AND $2
        GROUP BY pr.id ORDER BY gross DESC LIMIT 10`,
      [from, to],
    );
    const [subs] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE s.status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE s.status = 'TRIAL')::int AS trial,
              count(*) FILTER (WHERE s.status = 'GRACE')::int AS grace, count(*) FILTER (WHERE s.status = 'EXPIRED')::int AS expired,
              count(*) FILTER (WHERE s.current_period_end BETWEEN now() AND now() + interval '7 days')::int AS expiring_soon,
              coalesce(sum(pl.price * 30.0 / pl.duration_days) FILTER (WHERE s.status = 'ACTIVE'), 0)::float AS mrr
         FROM provider_subscriptions s LEFT JOIN subscription_plans pl ON pl.id = s.plan_id`,
    );
    const [review] = await this.ds.query(`SELECT count(*)::int AS n FROM subscription_invoices WHERE status = 'AWAITING_REVIEW'`);
    const balances = (await this.ds.query(BALANCE_SQL)).map((r: any) => this.balanceRow(r));
    return {
      totals: {
        servicesGross: R(t.services_gross),
        onlineGross: R(t.online_gross),
        deskGross: R(t.desk_gross),
        commission: R(t.commission),
        subscriptions: R(t.subscriptions),
        platformRevenue: R(t.commission + t.subscriptions),
        payments: t.payments,
        refunds: R(rf.refunds),
        refundsCount: rf.n,
        failedPayments: failed.n,
      },
      subscriptions: { ...subs, mrr: R(subs.mrr), awaitingReview: review.n },
      balances: {
        owedToProviders: R(balances.filter((b: any) => b.balance > 0).reduce((s: number, b: any) => s + b.balance, 0)),
        owedByProviders: R(-balances.filter((b: any) => b.balance < 0).reduce((s: number, b: any) => s + b.balance, 0)),
      },
      daily,
      byType,
      byService,
      topProviders,
    };
  }

  async balances(q: BalancesQuery) {
    const rows = (await this.ds.query(`${BALANCE_SQL} ${q.type ? 'WHERE pr.type = $1' : ''} ORDER BY pr.name_ar`, q.type ? [q.type] : [])).map((r: any) => this.balanceRow(r));
    const filtered = rows.filter((r: any) => (!q.nonZero || Math.abs(r.balance) >= 0.01 || r.onlineNet || r.cashCommission) && (!q.search || r.nameAr.includes(q.search)));
    const { skip, take } = skipTake(q);
    return paginate(filtered.slice(skip, skip + take), filtered.length, q);
  }

  // ─────────────── Provider statement ───────────────

  async providerStatement(user: AuthUser, fromIso?: string, toIso?: string) {
    const providerId = user.adminProviderIds[0];
    if (!providerId) throw new ForbiddenException('كشف الحساب متاح لمدير الحساب فقط');
    const { from, to } = this.range(fromIso, toIso);
    const [t] = await this.ds.query(
      `SELECT coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gross,
              coalesce(sum(c.commission_amount - c.reversed_commission), 0)::float AS commission,
              coalesce(sum(c.provider_amount - c.reversed_provider_amount), 0)::float AS net,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.collected_by = 'PLATFORM'), 0)::float AS online,
              coalesce(sum(p.amount - p.refunded_amount) FILTER (WHERE p.collected_by = 'PROVIDER'), 0)::float AS desk,
              count(*)::int AS payments
         FROM payments p LEFT JOIN commissions c ON c.payment_id = p.id
        WHERE p.provider_id = $1 AND p.entity_type <> 'SUBSCRIPTION' AND p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND p.paid_at BETWEEN $2 AND $3`,
      [providerId, from, to],
    );
    const [rf] = await this.ds.query(
      `SELECT coalesce(sum(r.amount), 0)::float AS refunds FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.provider_id = $1 AND r.status = 'COMPLETED' AND r.created_at BETWEEN $2 AND $3`,
      [providerId, from, to],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              coalesce((SELECT sum(p.amount - p.refunded_amount) FROM payments p WHERE p.provider_id = $1 AND p.entity_type <> 'SUBSCRIPTION' AND p.status IN ('PAID','PARTIALLY_REFUNDED') AND (p.paid_at AT TIME ZONE $4)::date = d::date), 0)::float AS gross,
              coalesce((SELECT sum(c.provider_amount - c.reversed_provider_amount) FROM commissions c JOIN payments p ON p.id = c.payment_id WHERE p.provider_id = $1 AND (p.paid_at AT TIME ZONE $4)::date = d::date), 0)::float AS net
         FROM generate_series(($2::timestamptz AT TIME ZONE $4)::date, ($3::timestamptz AT TIME ZONE $4)::date, interval '1 day') d`,
      [providerId, from, to, this.tz],
    );
    const byService = await this.ds.query(
      `SELECT p.entity_type, count(*)::int AS count, coalesce(sum(p.amount - p.refunded_amount), 0)::float AS gross
         FROM payments p WHERE p.provider_id = $1 AND p.entity_type <> 'SUBSCRIPTION' AND p.status IN ('PAID','PARTIALLY_REFUNDED') AND p.paid_at BETWEEN $2 AND $3 GROUP BY p.entity_type`,
      [providerId, from, to],
    );
    const [b] = await this.ds.query(`${BALANCE_SQL} WHERE pr.id = $1`, [providerId]);
    const settlements = await this.ds.query(`SELECT id, direction, amount::float AS amount, method, reference, note, created_at FROM provider_settlements WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 20`, [providerId]);
    const rule = await this.ruleFor(providerId);
    return {
      totals: { gross: R(t.gross), commission: R(t.commission), net: R(t.net), online: R(t.online), desk: R(t.desk), refunds: R(rf.refunds), payments: t.payments },
      balance: this.balanceRow(b),
      commissionRule: rule,
      daily,
      byService,
      settlements,
    };
  }

  private async ruleFor(providerId: string) {
    const [p] = await this.ds.query(`SELECT type FROM providers WHERE id = $1`, [providerId]);
    const [r] = await this.ds.query(
      `SELECT type, value::float AS value, scope FROM commission_rules WHERE is_active AND (provider_id = $1 OR (scope = 'PROVIDER_TYPE' AND provider_type = $2) OR scope = 'GLOBAL')
        ORDER BY CASE scope WHEN 'PROVIDER' THEN 0 WHEN 'PROVIDER_TYPE' THEN 1 ELSE 2 END LIMIT 1`,
      [providerId, p?.type],
    );
    return r ?? null;
  }

  // ─────────────── Settlements ───────────────

  async settle(user: AuthUser, dto: SettlementDto) {
    const [p] = await this.ds.query(`SELECT id, owner_user_id, name_ar FROM providers WHERE id = $1`, [dto.providerId]);
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    const s = await this.ds.getRepository(ProviderSettlement).save({ ...dto, method: dto.method ?? null, reference: dto.reference ?? null, note: dto.note ?? null, createdById: user.id });
    await this.audit.log({ userId: user.id, action: 'SETTLEMENT_RECORDED', entity: 'provider_settlements', entityId: s.id, newValue: dto });
    await this.notifications.notify(p.owner_user_id, {
      type: 'SETTLEMENT_RECORDED',
      category: 'PAYMENTS',
      title: dto.direction === 'TO_PROVIDER' ? 'تم تحويل مستحقاتك' : 'تم تسجيل سداد العمولة',
      body: `${dto.direction === 'TO_PROVIDER' ? 'حوّلت المنصة لك' : 'استلمت المنصة منك'} ${dto.amount} ج.م${dto.reference ? ` (مرجع ${dto.reference})` : ''}.`,
      data: {},
    });
    return { id: s.id };
  }

  async settlements(providerId?: string) {
    return this.ds.query(
      `SELECT s.id, s.direction, s.amount::float AS amount, s.method, s.reference, s.note, s.created_at, pr.name_ar AS provider_name, u.full_name AS by_name
         FROM provider_settlements s JOIN providers pr ON pr.id = s.provider_id LEFT JOIN users u ON u.id = s.created_by_id
        ${providerId ? 'WHERE s.provider_id = $1' : ''} ORDER BY s.created_at DESC LIMIT 100`,
      providerId ? [providerId] : [],
    );
  }

  // ─────────────── Commission rules ───────────────

  async rules() {
    return this.ds.query(
      `SELECT r.id, r.scope, r.provider_type, r.provider_id, r.type, r.value::float AS value, r.is_active, r.created_at, p.name_ar AS provider_name
         FROM commission_rules r LEFT JOIN providers p ON p.id = r.provider_id ORDER BY CASE r.scope WHEN 'GLOBAL' THEN 0 WHEN 'PROVIDER_TYPE' THEN 1 ELSE 2 END, r.created_at`,
    );
  }

  private checkRule(dto: CommissionRuleDto) {
    if (dto.type === 'PERCENTAGE' && dto.value > 100) throw new BadRequestException('النسبة لا تتجاوز 100%');
    if (dto.scope === CommissionScope.PROVIDER_TYPE && !dto.providerType) throw new BadRequestException('اختر نوع مقدم الخدمة');
    if (dto.scope === CommissionScope.PROVIDER && !dto.providerId) throw new BadRequestException('اختر مقدم الخدمة');
    return {
      scope: dto.scope,
      providerType: dto.scope === CommissionScope.PROVIDER_TYPE ? dto.providerType! : null,
      providerId: dto.scope === CommissionScope.PROVIDER ? dto.providerId! : null,
      type: dto.type,
      value: dto.value,
      isActive: dto.isActive ?? true,
    };
  }

  /** One active rule per scope target — a new one replaces the old (history stays in payment snapshots). */
  async saveRule(user: AuthUser, dto: CommissionRuleDto, id?: string) {
    const data = this.checkRule(dto);
    const repo = this.ds.getRepository(CommissionRule);
    return this.ds.transaction(async (m) => {
      if (data.isActive) {
        await m.query(
          `UPDATE commission_rules SET is_active = false WHERE scope = $1 AND provider_type IS NOT DISTINCT FROM $2 AND provider_id IS NOT DISTINCT FROM $3 AND ($4::uuid IS NULL OR id <> $4)`,
          [data.scope, data.providerType, data.providerId, id ?? null],
        );
      }
      let ruleId = id;
      if (id) {
        const old = await m.findOneBy(CommissionRule, { id });
        if (!old) throw new NotFoundException('القاعدة غير موجودة');
        await m.update(CommissionRule, id, data);
        await this.audit.log({ userId: user.id, action: 'COMMISSION_RULE_UPDATED', entity: 'commission_rules', entityId: id, oldValue: old, newValue: data }, m);
      } else {
        ruleId = (await m.save(repo.create(data))).id;
        await this.audit.log({ userId: user.id, action: 'COMMISSION_RULE_CREATED', entity: 'commission_rules', entityId: ruleId, newValue: data }, m);
      }
      return { id: ruleId };
    });
  }
}
