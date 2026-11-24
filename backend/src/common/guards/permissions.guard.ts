import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators';
import { AuthUser } from '../auth-user';

/** Global guard: enforces @RequirePermissions / @RequireAnyPermission. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const all = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!all?.length && !any?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('غير مصرح لك بتنفيذ هذا الإجراء');
    if (all?.length && !all.every((p) => user.permissions.has(p))) {
      throw new ForbiddenException('غير مصرح لك بتنفيذ هذا الإجراء');
    }
    if (any?.length && !any.some((p) => user.permissions.has(p))) {
      throw new ForbiddenException('غير مصرح لك بتنفيذ هذا الإجراء');
    }
    return true;
  }
}
