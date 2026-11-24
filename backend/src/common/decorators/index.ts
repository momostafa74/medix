import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../permissions';
import { AuthUser } from '../auth-user';

export const ALLOW_UNSUBSCRIBED = 'allowUnsubscribed';
/** Reachable by provider accounts whose subscription lapsed (auth, renewal, notifications…). */
export const AllowUnsubscribed = () => SetMetadata(ALLOW_UNSUBSCRIBED, true);

export const IS_PUBLIC = 'isPublic';
/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** User must hold ALL listed permissions. */
export const RequirePermissions = (...perms: PermissionCode[]) => SetMetadata(PERMISSIONS_KEY, perms);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';
/** User must hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...perms: PermissionCode[]) => SetMetadata(ANY_PERMISSIONS_KEY, perms);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Client IP + user agent for audit logs. */
export const ReqMeta = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip as string, userAgent: (req.headers['user-agent'] as string) || null };
});
export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}
