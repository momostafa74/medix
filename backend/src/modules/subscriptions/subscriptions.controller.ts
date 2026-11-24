import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowUnsubscribed, CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { SubscriptionsService } from './subscriptions.service';
import { ExtendDto, InvoicesQuery, ManualSubscriptionDto, PlanDto, ReviewInvoiceDto, SubscribeDto, SubscriptionsQuery } from './subscriptions.dto';
import { CachePublic, InvalidatesCache } from '../../common/cache/http-cache.interceptor';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subs: SubscriptionsService) {}

  @Public()
  @CachePublic(300, 'plans')
  @Get('plans')
  @ApiOperation({ summary: 'Active plans (optionally for one provider type)' })
  plans(@Query('type') type?: string) {
    return this.subs.plans(type);
  }

  @Get('me')
  @AllowUnsubscribed()
  @ApiOperation({ summary: "My provider's subscription, plans, invoices and payment options" })
  me(@CurrentUser() u: AuthUser) {
    return this.subs.mine(u);
  }

  @Post('me/subscribe')
  @AllowUnsubscribed()
  @ApiOperation({ summary: 'Buy / renew: ONLINE → redirect to the gateway; INSTAPAY / VODAFONE_CASH / BANK_TRANSFER → receipt reviewed by finance' })
  subscribe(@CurrentUser() u: AuthUser, @Body() dto: SubscribeDto, @ReqMeta() meta: RequestMeta) {
    return this.subs.subscribe(u, dto, meta);
  }
}

@ApiTags('Subscriptions — admin')
@ApiBearerAuth()
@Controller('admin/subscriptions')
export class SubscriptionsAdminController {
  constructor(private subs: SubscriptionsService) {}

  @Get()
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  list(@Query() q: SubscriptionsQuery) {
    return this.subs.list(q);
  }

  @Get('invoices')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  invoices(@Query() q: InvoicesQuery) {
    return this.subs.invoices(q);
  }

  @Post('invoices/:id/approve')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInvoiceDto, @ReqMeta() meta: RequestMeta) {
    return this.subs.approve(u, id, dto.note, meta);
  }

  @Post('invoices/:id/reject')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInvoiceDto, @ReqMeta() meta: RequestMeta) {
    return this.subs.reject(u, id, dto.note, meta);
  }

  @Post('providers/:providerId/payments')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  @ApiOperation({ summary: 'Record a subscription paid in cash / verified transfer' })
  manual(@CurrentUser() u: AuthUser, @Param('providerId', ParseUUIDPipe) id: string, @Body() dto: ManualSubscriptionDto, @ReqMeta() meta: RequestMeta) {
    return this.subs.recordManual(u, id, dto, meta);
  }

  @Post('providers/:providerId/extend')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  extend(@CurrentUser() u: AuthUser, @Param('providerId', ParseUUIDPipe) id: string, @Body() dto: ExtendDto, @ReqMeta() meta: RequestMeta) {
    return this.subs.extend(u, id, dto, meta);
  }

  @Get('plans')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  plans() {
    return this.subs.allPlans();
  }

  @Post('plans')
  @InvalidatesCache('plans')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  createPlan(@CurrentUser() u: AuthUser, @Body() dto: PlanDto) {
    return this.subs.savePlan(u, dto);
  }

  @Patch('plans/:id')
  @InvalidatesCache('plans')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  updatePlan(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.subs.savePlan(u, dto, id);
  }

  @Post('sync')
  @RequirePermissions(P.SUBSCRIPTIONS_MANAGE)
  @ApiOperation({ summary: 'Run the status / visibility / reminder job now' })
  async sync() {
    await this.subs.sync();
    return { ok: true };
  }
}
