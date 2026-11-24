import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { SettingsService } from './settings.service';
import { CachePublic, InvalidatesCache } from '../../common/cache/http-cache.interceptor';

class SetSettingDto {
  @ApiProperty() @IsDefined() value!: unknown;
}

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Public()
  @CachePublic(60, 'settings')
  @Get('public')
  publicSettings() {
    return this.service.all(true);
  }

  @ApiBearerAuth()
  @Get()
  @RequirePermissions(P.SETTINGS_MANAGE)
  all() {
    return this.service.all(false);
  }

  @ApiBearerAuth()
  @Put(':key')
  @InvalidatesCache('settings')
  @RequirePermissions(P.SETTINGS_MANAGE)
  set(@Param('key') key: string, @Body() dto: SetSettingDto, @CurrentUser() u: AuthUser) {
    return this.service.set(key, dto.value, u.id);
  }
}
