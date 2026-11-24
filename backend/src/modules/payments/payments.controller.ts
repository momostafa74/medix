import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AllowUnsubscribed, CurrentUser, Public, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { PaymentsService } from './payments.service';
import { CouponsService } from './coupons.service';
import { FinanceService } from './finance.service';
import { PaymobGateway } from './gateways/paymob.gateway';
import { CachePublic } from '../../common/cache/http-cache.interceptor';
import {
  BalancesQuery,
  CheckoutDto,
  CommissionRuleDto,
  CouponDto,
  CouponPreviewDto,
  CouponsQuery,
  FinanceQuery,
  PaymentsQuery,
  RefundDto,
  SandboxCompleteDto,
  SettlementDto,
} from './payments.dto';

const sendPdf = (res: Response, { buffer, fileName }: { buffer: Buffer; fileName: string }) => {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
  res.end(buffer);
};

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private coupons: CouponsService,
    private paymob: PaymobGateway,
    private config: ConfigService,
  ) {}

  @Public()
  @CachePublic(60, 'settings')
  @Get('config')
  @ApiOperation({ summary: 'Is online payment available + manual transfer instructions' })
  cfg() {
    return this.payments.config();
  }

  @Post('checkout')
  @RequirePermissions(P.PAYMENTS_PAY)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start an online payment for your booking / order (amount is taken from the record)' })
  checkout(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto, @ReqMeta() meta: RequestMeta) {
    return this.payments.checkout(u, dto.entityType, dto.entityId, meta);
  }

  @Post('coupons/preview')
  @AllowUnsubscribed()
  @ApiOperation({ summary: 'Check a coupon code before booking / paying (nothing is reserved)' })
  preview(@CurrentUser() u: AuthUser, @Body() dto: CouponPreviewDto) {
    return this.coupons.preview(u, dto.code, dto.serviceType, dto.providerId, dto.amount);
  }

  @Get('mine')
  @ApiOperation({ summary: 'My payments (patient)' })
  mine(@CurrentUser() u: AuthUser, @Query() q: PaymentsQuery) {
    return this.payments.list(u, 'mine', q);
  }

  @Get('provider')
  @RequirePermissions(P.PAYMENTS_READ_PROVIDER)
  @ApiOperation({ summary: 'Payments received by my provider (with commission split)' })
  provider(@CurrentUser() u: AuthUser, @Query() q: PaymentsQuery) {
    return this.payments.list(u, 'provider', q);
  }

  @Get('admin')
  @RequirePermissions(P.FINANCE_READ)
  admin(@CurrentUser() u: AuthUser, @Query() q: PaymentsQuery) {
    return this.payments.list(u, 'admin', q);
  }

  @Get('record/:entityType/:entityId')
  @ApiOperation({ summary: 'Payment state of a booking / order (drives the "pay online" button)' })
  record(@CurrentUser() u: AuthUser, @Param('entityType') t: string, @Param('entityId', ParseUUIDPipe) id: string) {
    return this.payments.forRecord(u, t, id);
  }

  @Get(':id')
  @AllowUnsubscribed()
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(u, id);
  }

  @Get(':id/receipt.pdf')
  @AllowUnsubscribed()
  async receipt(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendPdf(res, await this.payments.receipt(u, id));
  }

  @Post(':id/refund')
  @RequirePermissions(P.PAYMENTS_REFUND)
  @ApiOperation({ summary: 'Full or partial refund (online → through the gateway; commission reversed proportionally)' })
  refund(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto, @ReqMeta() meta: RequestMeta) {
    return this.payments.refund(u, id, dto, meta);
  }

  // ─────────── Gateways ───────────

  @Public()
  @Get('sandbox/:id')
  sandboxInfo(@Param('id', ParseUUIDPipe) id: string, @Query('sig') sig: string) {
    return this.payments.sandboxInfo(id, sig);
  }

  @Public()
  @Post('sandbox/:id/complete')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sandboxComplete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SandboxCompleteDto) {
    return this.payments.sandboxComplete(id, dto.sig, dto.card);
  }

  @Public()
  @Post('paymob/callback')
  @ApiOperation({ summary: 'Paymob "transaction processed" webhook (HMAC verified)' })
  async paymobCallback(@Body() body: any, @Query('hmac') hmac: string) {
    const r = this.paymob.parseCallback(body, hmac);
    if (!r) return { ok: false };
    await this.payments.complete(r, 'paymob').catch(() => undefined);
    return { ok: true };
  }

  @Public()
  @Get('paymob/return')
  async paymobReturn(@Req() req: Request, @Res() res: Response) {
    const r = this.paymob.parseReturn(req.query as Record<string, string>);
    const front = this.config.get<string>('frontendUrl')!.replace(/\/$/, '');
    let target = `${front}/payment/result?status=unknown`;
    if (r) {
      const out = await this.payments.complete(r, 'paymob').catch(() => null);
      if (out) target = `${front}/payment/result?payment=${out.paymentId}`;
    }
    res.redirect(302, target);
  }
}

@ApiTags('Finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(
    private finance: FinanceService,
    private coupons: CouponsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(P.FINANCE_READ)
  dashboard(@Query() q: FinanceQuery) {
    return this.finance.adminDashboard(q.from, q.to);
  }

  @Get('statement')
  @RequirePermissions(P.PAYMENTS_READ_PROVIDER)
  @ApiOperation({ summary: "Provider earnings: gross, commission, net, balance with the platform" })
  statement(@CurrentUser() u: AuthUser, @Query() q: FinanceQuery) {
    return this.finance.providerStatement(u, q.from, q.to);
  }

  @Get('balances')
  @RequireAnyPermission(P.FINANCE_READ, P.SETTLEMENTS_MANAGE)
  balances(@Query() q: BalancesQuery) {
    return this.finance.balances(q);
  }

  @Get('settlements')
  @RequireAnyPermission(P.FINANCE_READ, P.SETTLEMENTS_MANAGE)
  settlements(@Query('providerId') providerId?: string) {
    return this.finance.settlements(providerId && /^[0-9a-f-]{36}$/i.test(providerId) ? providerId : undefined);
  }

  @Post('settlements')
  @RequirePermissions(P.SETTLEMENTS_MANAGE)
  settle(@CurrentUser() u: AuthUser, @Body() dto: SettlementDto) {
    return this.finance.settle(u, dto);
  }

  @Get('commission-rules')
  @RequireAnyPermission(P.COMMISSION_MANAGE, P.FINANCE_READ)
  rules() {
    return this.finance.rules();
  }

  @Post('commission-rules')
  @RequirePermissions(P.COMMISSION_MANAGE)
  createRule(@CurrentUser() u: AuthUser, @Body() dto: CommissionRuleDto) {
    return this.finance.saveRule(u, dto);
  }

  @Patch('commission-rules/:id')
  @RequirePermissions(P.COMMISSION_MANAGE)
  updateRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommissionRuleDto) {
    return this.finance.saveRule(u, dto, id);
  }

  @Get('coupons')
  @RequirePermissions(P.COUPONS_MANAGE)
  listCoupons(@Query() q: CouponsQuery) {
    return this.coupons.list(q);
  }

  @Post('coupons')
  @RequirePermissions(P.COUPONS_MANAGE)
  createCoupon(@CurrentUser() u: AuthUser, @Body() dto: CouponDto) {
    return this.coupons.create(u, dto);
  }

  @Patch('coupons/:id')
  @RequirePermissions(P.COUPONS_MANAGE)
  updateCoupon(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CouponDto) {
    return this.coupons.update(u, id, dto);
  }
}
