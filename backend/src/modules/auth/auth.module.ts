import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session, User, VerificationToken } from '../../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUserLoader } from './auth-user.loader';
import { JwtStrategy } from './jwt.strategy';
import { TwoFactorService } from './two-factor.service';

@Global()
@Module({
  imports: [PassportModule, JwtModule.register({}), TypeOrmModule.forFeature([User, Session, VerificationToken])],
  providers: [AuthService, AuthUserLoader, JwtStrategy, TwoFactorService],
  controllers: [AuthController],
  exports: [AuthService, AuthUserLoader, TwoFactorService],
})
export class AuthModule {}
