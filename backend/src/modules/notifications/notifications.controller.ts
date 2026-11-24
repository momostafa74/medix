import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AllowUnsubscribed, CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { NotificationChannel } from '../../database/entities';
import { NotificationsService } from './notifications.service';

class ListNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;
}

class PreferenceItemDto {
  @ApiProperty() @IsString() category!: string;
  @ApiProperty({ enum: NotificationChannel }) @IsEnum(NotificationChannel) channel!: NotificationChannel;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}

class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  items!: PreferenceItemDto[];
}

@ApiTags('Notifications')
@ApiBearerAuth()
@AllowUnsubscribed()
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListNotificationsDto) {
    return this.service.list(u.id, q.page, q.pageSize, !!q.unreadOnly);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { count: await this.service.unreadCount(u.id) };
  }

  @Patch('read-all')
  readAll(@CurrentUser() u: AuthUser) {
    return this.service.markAllRead(u.id);
  }

  @Patch(':id/read')
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(u.id, id);
  }

  @Get('preferences')
  prefs(@CurrentUser() u: AuthUser) {
    return this.service.getPreferences(u.id);
  }

  @Put('preferences')
  setPrefs(@CurrentUser() u: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.service.setPreferences(u.id, dto.items);
  }
}
