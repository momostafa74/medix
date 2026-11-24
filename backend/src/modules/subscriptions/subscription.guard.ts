import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_UNSUBSCRIBED, IS_PUBLIC } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';

/**
 * Global guard (after JWT): a doctor / lab / radiology / pharmacy account whose provider
 * subscription lapsed (period + grace days) can only reach routes marked @AllowUnsubscribed —
 * sign-in, renewal and payment. Everything else answers 402 SUBSCRIPTION_REQUIRED.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNSUBSCRIBED, targets)) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user?.subscription?.blocked) return true;
    throw new HttpException(
      { statusCode: 402, error: 'SUBSCRIPTION_REQUIRED', message: 'انتهى اشتراك حسابك. جدّد الاشتراك لمتابعة استخدام المنصة.' },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
