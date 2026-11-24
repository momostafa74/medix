import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { AvailabilityService } from '../schedules/availability.service';
import { AvailabilityQuery } from '../schedules/schedules.dto';
import { DoctorsService } from './doctors.service';
import { SearchDoctorsQuery, UpdateDoctorProfileDto } from './doctors.dto';
import { NotFoundException } from '@nestjs/common';

@ApiTags('Doctors')
@Controller('doctors')
export class DoctorsController {
  constructor(
    private service: DoctorsService,
    private availability: AvailabilityService,
  ) {}

  @Public()
  @Get()
  search(@Query() q: SearchDoctorsQuery) {
    return this.service.search(q);
  }

  @ApiBearerAuth()
  @Get('me/profile')
  @RequirePermissions(P.DOCTOR_PROFILE_OWN)
  me(@CurrentUser() u: AuthUser) {
    return this.service.getOwnProfile(u);
  }

  @ApiBearerAuth()
  @Patch('me/profile')
  @RequirePermissions(P.DOCTOR_PROFILE_OWN)
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateDoctorProfileDto) {
    return this.service.updateOwnProfile(u, dto);
  }

  @Public()
  @Get(':id/availability')
  async availabilityFor(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQuery, @CurrentUser() u?: AuthUser) {
    const doctor = await this.availability.loadDoctor(id);
    const privileged = u && (u.doctorId === id || u.permissions.has(P.APPOINTMENTS_MANAGE_ANY));
    if (!this.availability.isBookable(doctor) && !privileged) throw new NotFoundException('الطبيب غير موجود');
    const from = q.from ?? this.availability.todayLocal();
    return {
      doctorId: id,
      timezone: this.availability.tz,
      days: await this.availability.getRange(id, from, q.days ?? 7, q.type),
    };
  }

  @Public()
  @Get(':idOrSlug')
  profile(@Param('idOrSlug') key: string, @CurrentUser() u?: AuthUser) {
    return this.service.getPublicProfile(key, u);
  }
}
