import { Body, Controller, Delete, Get, HttpCode, OnModuleInit, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowUnsubscribed, CurrentUser, Public, ReqMeta, RequestMeta } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { AuthService, TokenPair } from './auth.service';
import {
  ChangePasswordDto,
  ConfirmVerificationDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDoctorDto,
  RegisterProviderDto,
  RegisterPatientDto,
  RequestVerificationDto,
  ResetPasswordDto,
  TwoFactorCodeDto,
  TwoFactorDisableDto,
  TwoFactorVerifyDto,
} from './auth.dto';
import { TwoFactorService } from './two-factor.service';

export const REFRESH_COOKIE = 'medix_rt';

/**
 * Token transport:
 *  - access token  → JSON body, kept in memory by the SPA, sent as Bearer header
 *  - refresh token → httpOnly + SameSite=Strict cookie scoped to /api/auth
 *    (unreadable by JS → XSS can't steal it; SameSite=Strict → CSRF can't use it).
 *    Non-browser clients may send it in the body instead.
 */
@ApiTags('Auth')
@AllowUnsubscribed()
@Controller('auth')
export class AuthController implements OnModuleInit {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private twoFactor: TwoFactorService,
  ) {}

  onModuleInit() {
    this.auth.registerJobs();
  }

  private setCookie(res: Response, pair: TokenPair) {
    res.cookie(REFRESH_COOKIE, pair.refreshToken, {
      httpOnly: true,
      secure: this.config.get('cookies.secure'),
      sameSite: 'strict',
      domain: this.config.get('cookies.domain'),
      path: '/api/auth',
      expires: pair.refreshExpiresAt,
    });
  }

  private respond(res: Response, result: TokenPair & Record<string, unknown>) {
    this.setCookie(res, result);
    const { refreshToken: _rt, refreshExpiresAt: _e, ...rest } = result;
    return rest;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a patient account' })
  async register(@Body() dto: RegisterPatientDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.registerPatient(dto, meta));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/doctor')
  @ApiOperation({ summary: 'Register a doctor (profile stays hidden until admin approval)' })
  async registerDoctor(@Body() dto: RegisterDoctorDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.registerDoctor(dto, meta));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/provider')
  @ApiOperation({ summary: 'Register a laboratory / radiology center / pharmacy (hidden until admin approval)' })
  async registerProvider(@Body() dto: RegisterProviderDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.registerProvider(dto, meta));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Sign in. With two-step verification on, answers { twoFactorRequired, challengeToken } instead of tokens → POST /auth/2fa/verify' })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, meta);
    if ('twoFactorRequired' in result) return result;
    return this.respond(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/verify')
  @ApiOperation({ summary: 'Second login step: authenticator code or backup code' })
  async verify2fa(@Body() dto: TwoFactorVerifyDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.completeTwoFactor(dto.challengeToken, dto.code, meta));
  }

  @ApiBearerAuth()
  @Get('2fa')
  @ApiOperation({ summary: 'My two-step verification status' })
  async status2fa(@CurrentUser() u: AuthUser) {
    const me = await this.auth.me(u.id);
    return { enabled: me.twoFactorEnabled, required: me.twoFactorSetupRequired, backupCodesLeft: me.twoFactorEnabled ? await this.twoFactor.backupCodesLeft(u.id) : 0 };
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Start enrolment: secret + otpauth URL + QR (not active until confirmed)' })
  setup2fa(@CurrentUser() u: AuthUser) {
    return this.twoFactor.setup(u.id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/enable')
  @ApiOperation({ summary: 'Confirm with the first code → returns 10 one-time backup codes (shown once)' })
  enable2fa(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.twoFactor.enable(u.id, dto.code, meta);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/backup-codes')
  regenerate2fa(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.twoFactor.regenerateBackupCodes(u.id, dto.code, meta);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/disable')
  disable2fa(@CurrentUser() u: AuthUser, @Body() dto: TwoFactorDisableDto, @ReqMeta() meta: RequestMeta) {
    return this.twoFactor.disable(u.id, dto.password, dto.code, meta);
  }

  @ApiBearerAuth()
  @Get('login-history')
  @ApiOperation({ summary: 'My recent sign-ins and security events' })
  loginHistory(@CurrentUser() u: AuthUser) {
    return this.auth.loginHistory(u.id);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Body() dto: RefreshDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] || dto.refreshToken;
    try {
      const pair = await this.auth.refresh(token, meta);
      this.setCookie(res, pair);
      return { accessToken: pair.accessToken, ...(dto.refreshToken ? { refreshToken: pair.refreshToken } : {}) };
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw e;
    }
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] || dto.refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return this.auth.logoutAll(u.id, meta);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.auth.listSessions(u.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(u.id, id);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @CurrentUser() u: AuthUser,
    @Body() dto: ChangePasswordDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.changePassword(u.id, dto, meta));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.forgotPassword(dto.identifier, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.resetPassword(dto, meta);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verification/request')
  requestVerification(@CurrentUser() u: AuthUser, @Body() dto: RequestVerificationDto) {
    return this.auth.requestVerification(u.id, dto.channel);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verification/confirm')
  confirmVerification(@CurrentUser() u: AuthUser, @Body() dto: ConfirmVerificationDto) {
    return this.auth.confirmVerification(u.id, dto.token);
  }
}
