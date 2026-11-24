import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { AppointmentsService } from './appointments.service';
import { BookAppointmentDto, CancelDto, DoctorNotesDto, ListAppointmentsQuery, RescheduleDto, UpdateStatusDto } from './appointments.dto';

const READ = [P.APPOINTMENTS_READ_OWN, P.APPOINTMENTS_READ_PROVIDER, P.APPOINTMENTS_READ_ANY] as const;

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private service: AppointmentsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireAnyPermission(P.APPOINTMENTS_BOOK, P.APPOINTMENTS_MANAGE_ANY)
  @ApiOperation({ summary: 'Book a slot. Double booking is rejected with 409 SLOT_UNAVAILABLE.' })
  book(@CurrentUser() u: AuthUser, @Body() dto: BookAppointmentDto, @ReqMeta() meta: RequestMeta) {
    return this.service.book(u, dto, meta);
  }

  @Get()
  @RequireAnyPermission(...READ)
  list(@CurrentUser() u: AuthUser, @Query() q: ListAppointmentsQuery) {
    return this.service.list(u, q);
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getOne(u, id);
  }

  @Patch(':id/cancel')
  @RequireAnyPermission(...READ)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @ReqMeta() meta: RequestMeta) {
    return this.service.cancel(u, id, dto.reason, meta);
  }

  @Patch(':id/reschedule')
  @RequireAnyPermission(...READ)
  reschedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto, @ReqMeta() meta: RequestMeta) {
    return this.service.reschedule(u, id, dto, meta);
  }

  @Patch(':id/status')
  @RequireAnyPermission(P.APPOINTMENTS_MANAGE_PROVIDER, P.APPOINTMENTS_MANAGE_ANY)
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.service.updateStatus(u, id, dto, meta);
  }

  @Patch(':id/doctor-notes')
  @RequirePermissions(P.APPOINTMENTS_MANAGE_PROVIDER)
  notes(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DoctorNotesDto) {
    return this.service.setDoctorNotes(u, id, dto.doctorNotes);
  }
}
