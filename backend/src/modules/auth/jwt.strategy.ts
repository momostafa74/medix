import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../../database/entities';
import { AuthUserLoader } from './auth-user.loader';

export interface AccessPayload {
  sub: string;
  tv: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private loader: AuthUserLoader,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessPayload & { purpose?: string }) {
    // Only plain access tokens are accepted (defence in depth against purpose-specific tokens).
    if (payload.purpose) throw new UnauthorizedException('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى');
    const user = await this.loader.load(payload.sub);
    if (!user || user.status !== UserStatus.ACTIVE || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى');
    }
    return user;
  }
}
