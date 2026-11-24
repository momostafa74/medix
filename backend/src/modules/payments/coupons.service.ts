import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Coupon, CouponRedemption } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { CouponError, ENTITY_SERVICE, ServiceType, couponDiscount } from './payments-logic';
import { CouponDto, CouponsQuery } from './payments.dto';

export interface RedeemInput {
  code: string;
  entityType: string;
  entityId: string;
  providerId: string;
  amount: number;
  patientId?: string | null;
  /** Subscriptions are redeemed by the provider. */
  redeemerProviderId?: string | null;
}

@Injectable()
export class CouponsService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
  ) {}

  private normalize(code: string) {
    return code.trim().toUpperCase();
  }

  private toHttp(e: unknown): never {
    if (e instanceof CouponError) throw new BadRequestException({ message: e.message, code: e.code });
    throw e;
  }

  private async userUses(m: EntityManager, couponId: string, patientId?: string | null, providerId?: string | null) {
    const [{ n }] = await m.query(
      `SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1 AND (($2::uuid IS NOT NULL AND patient_id = $2) OR ($3::uuid IS NOT NULL AND provider_id = $3))`,
      [couponId, patientId ?? null, providerId ?? null],
    );
    return n as number;
  }

  /** Preview for the UI — nothing is reserved. */
  async preview(user: AuthUser, code: string, serviceType: ServiceType, providerId: string, amount: number) {
    const c = await this.ds.getRepository(Coupon).findOne({ where: { code: this.normalize(code) } });
    if (!c) throw new NotFoundException({ message: 'كود الخصم غير صحيح', code: 'COUPON_NOT_FOUND' });
    const uses = await this.userUses(this.ds.manager, c.id, user.patientId, serviceType === 'SUBSCRIPTION' ? providerId : null);
    try {
      const discount = couponDiscount(c, { amount, serviceType, providerId, userUses: uses });
      return { code: c.code, discount, total: Math.round((amount - discount) * 100) / 100, description: c.description };
    } catch (e) {
      this.toHttp(e);
    }
  }

  /**
   * Reserves one use inside the caller's transaction. The coupon row is locked, so two
   * patients racing for the last use of a limited coupon cannot both get it.
   */
  async redeem(m: EntityManager, input: RedeemInput) {
    const c = await m.findOne(Coupon, { where: { code: this.normalize(input.code) }, lock: { mode: 'pessimistic_write' } });
    if (!c) throw new NotFoundException({ message: 'كود الخصم غير صحيح', code: 'COUPON_NOT_FOUND' });
    const serviceType = ENTITY_SERVICE[input.entityType];
    const uses = await this.userUses(m, c.id, input.patientId, input.redeemerProviderId);
    let discount = 0;
    try {
      discount = couponDiscount(c, { amount: input.amount, serviceType, providerId: input.providerId, userUses: uses });
    } catch (e) {
      this.toHttp(e);
    }
    await m.update(Coupon, c.id, { usedCount: () => 'used_count + 1' } as any);
    await m.insert(CouponRedemption, {
      couponId: c.id,
      patientId: input.patientId ?? null,
      providerId: input.redeemerProviderId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      discount,
    });
    return { couponId: c.id, discount };
  }

  /** Recomputes a redeemed coupon on a new amount (pharmacy confirmation). Drops it if it no longer applies. */
  async recompute(m: EntityManager, couponId: string, entityType: string, entityId: string, providerId: string, amount: number) {
    const c = await m.findOne(Coupon, { where: { id: couponId } });
    if (!c) return { discount: 0, dropped: true };
    try {
      // Usage limits were already checked when it was redeemed.
      const discount = couponDiscount({ ...c, usageLimit: null, perUserLimit: null, isActive: true, expiresAt: null }, { amount, serviceType: ENTITY_SERVICE[entityType], providerId, userUses: 0 });
      await m.update(CouponRedemption, { couponId, entityType, entityId }, { discount });
      return { discount, dropped: false };
    } catch {
      await this.release(m, entityType, entityId);
      return { discount: 0, dropped: true };
    }
  }

  /** Gives the use back (cancelled booking / order). */
  async release(m: EntityManager, entityType: string, entityId: string) {
    // DELETE … RETURNING comes back as [rows, affectedCount].
    const [rows]: [{ coupon_id: string }[]] = await m.query(`DELETE FROM coupon_redemptions WHERE entity_type = $1 AND entity_id = $2 RETURNING coupon_id`, [entityType, entityId]);
    for (const r of rows) await m.query(`UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1`, [r.coupon_id]);
    return rows.length > 0;
  }

  async moveRedemption(m: EntityManager, entityType: string, fromId: string, toId: string) {
    await m.query(`UPDATE coupon_redemptions SET entity_id = $3 WHERE entity_type = $1 AND entity_id = $2`, [entityType, fromId, toId]);
  }

  // ─────────────── Admin ───────────────

  async list(q: CouponsQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search?.trim()) {
      params.push(`%${likeEscape(q.search.trim())}%`);
      where.push(`(c.code ILIKE $${params.length} OR c.description ILIKE $${params.length})`);
    }
    if (q.serviceType) {
      params.push(q.serviceType);
      where.push(`c.service_type = $${params.length}`);
    }
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM coupons c ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT c.*, p.name_ar AS provider_name,
              (SELECT coalesce(sum(r.discount), 0) FROM coupon_redemptions r WHERE r.coupon_id = c.id)::float AS total_discount
         FROM coupons c LEFT JOIN providers p ON p.id = c.provider_id ${cond} ORDER BY c.created_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        description: r.description,
        type: r.type,
        value: Number(r.value),
        maxDiscount: r.max_discount != null ? Number(r.max_discount) : null,
        minOrder: r.min_order != null ? Number(r.min_order) : null,
        usageLimit: r.usage_limit,
        perUserLimit: r.per_user_limit,
        usedCount: r.used_count,
        providerId: r.provider_id,
        providerName: r.provider_name,
        serviceType: r.service_type,
        startsAt: r.starts_at,
        expiresAt: r.expires_at,
        isActive: r.is_active,
        totalDiscount: r.total_discount,
      })),
      total,
      q,
    );
  }

  private validate(dto: CouponDto) {
    if (dto.type === 'PERCENTAGE' && dto.value > 100) throw new BadRequestException('نسبة الخصم لا تتجاوز 100%');
    if (dto.startsAt && dto.expiresAt && new Date(dto.expiresAt) <= new Date(dto.startsAt)) throw new BadRequestException('تاريخ الانتهاء يجب أن يكون بعد البداية');
  }

  async create(user: AuthUser, dto: CouponDto) {
    this.validate(dto);
    const code = this.normalize(dto.code);
    if (await this.ds.getRepository(Coupon).exist({ where: { code } })) throw new ConflictException('الكود مستخدم من قبل');
    const c = await this.ds.getRepository(Coupon).save(this.ds.getRepository(Coupon).create({ ...this.fields(dto), code } as Partial<Coupon>));
    await this.audit.log({ userId: user.id, action: 'COUPON_CREATED', entity: 'coupons', entityId: c.id, newValue: dto });
    return { id: c.id };
  }

  async update(user: AuthUser, id: string, dto: CouponDto) {
    this.validate(dto);
    const c = await this.ds.getRepository(Coupon).findOneBy({ id });
    if (!c) throw new NotFoundException('الكود غير موجود');
    const code = this.normalize(dto.code);
    if (code !== c.code && (await this.ds.getRepository(Coupon).exist({ where: { code } }))) throw new ConflictException('الكود مستخدم من قبل');
    await this.ds.getRepository(Coupon).update(id, { ...this.fields(dto), code } as any);
    await this.audit.log({ userId: user.id, action: 'COUPON_UPDATED', entity: 'coupons', entityId: id, oldValue: c, newValue: dto });
    return { ok: true };
  }

  private fields(dto: CouponDto) {
    return {
      description: dto.description?.trim() || null,
      type: dto.type,
      value: dto.value,
      maxDiscount: dto.maxDiscount ?? null,
      minOrder: dto.minOrder ?? null,
      usageLimit: dto.usageLimit ?? null,
      perUserLimit: dto.perUserLimit ?? null,
      providerId: dto.providerId ?? null,
      serviceType: dto.serviceType ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      isActive: dto.isActive ?? true,
    };
  }
}
