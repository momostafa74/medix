import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_UNSUBSCRIBED, IS_PUBLIC } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';

/**
 * Global guard: when `security.require2faForStaff` is on, platform staff without two-step
 * verification can only reach account-setup routes (auth, own profile, notifications, files —
 * the same routes marked @AllowUnsubscribed) until they enrol.
 */
@Injectable()
export class TwoFactorPolicyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNSUBSCRIBED, targets)) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user?.twoFactorSetupRequired) return true;
    throw new ForbiddenException({ error: 'TWO_FACTOR_SETUP_REQUIRED', message: 'فعّل التحقق بخطوتين من إعدادات حسابك أولاً — مطلوب لحسابات فريق المنصة.' });
  }
}
