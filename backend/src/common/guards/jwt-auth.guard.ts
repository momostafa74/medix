import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from '../decorators';

/**
 * Global guard. Every route requires a valid access token unless marked @Public().
 * On public routes a valid token is still parsed (so responses can be personalised)
 * but its absence is not an error.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) {
      const req = ctx.switchToHttp().getRequest();
      if (!req.headers.authorization) return true;
      try {
        await super.canActivate(ctx);
      } catch {
        req.user = undefined;
      }
      return true;
    }
    return (await super.canActivate(ctx)) as boolean;
  }
}
