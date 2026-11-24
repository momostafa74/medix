import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsIP, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';
import { P } from '../../common/permissions';
import { SECURITY_ACTIONS, SecurityService } from './security.service';

class OverviewQuery {
  @ApiPropertyOptional({ default: 7 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}

class EventsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SECURITY_ACTIONS }) @IsOptional() @IsIn(SECURITY_ACTIONS) action?: string;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() alertsOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIP() ip?: string;
}

class ReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

@ApiTags('Security')
@ApiBearerAuth()
@Controller('security')
export class SecurityController {
  constructor(private service: SecurityService) {}

  @Get('overview')
  @RequirePermissions(P.SECURITY_READ)
  @ApiOperation({ summary: 'Sign-ins vs failures, lockouts, suspicious IPs, locked accounts, staff 2FA adoption, policy' })
  overview(@Query() q: OverviewQuery) {
    return this.service.overview(q.days ?? 7);
  }

  @Get('events')
  @RequirePermissions(P.SECURITY_READ)
  events(@Query() q: EventsQuery) {
    return this.service.events(q);
  }

  @Post('users/:id/unlock')
  @HttpCode(200)
  @RequirePermissions(P.SECURITY_MANAGE)
  unlock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.service.unlock(u, id, meta);
  }

  @Post('users/:id/reset-2fa')
  @HttpCode(200)
  @RequirePermissions(P.SECURITY_MANAGE)
  @ApiOperation({ summary: 'Turn off two-step verification for a user who lost their device (also signs them out everywhere)' })
  reset2fa(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @ReqMeta() meta: RequestMeta) {
    return this.service.resetTwoFactor(u, id, dto.reason, meta);
  }

  @Post('users/:id/logout-all')
  @HttpCode(200)
  @RequirePermissions(P.SECURITY_MANAGE)
  logoutAll(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.service.forceLogout(u, id, meta);
  }
}
