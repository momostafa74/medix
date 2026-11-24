import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequireAnyPermission } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { SchedulesService } from './schedules.service';
import { DoctorScopeQuery, ExceptionDto, ReplaceScheduleDto, SlotBlockDto } from './schedules.dto';

@ApiTags('Doctor schedule')
@ApiBearerAuth()
@Controller('doctors/me')
@RequireAnyPermission(P.SCHEDULES_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
export class SchedulesController {
  constructor(private service: SchedulesService) {}

  @Get('schedule')
  get(@CurrentUser() u: AuthUser, @Query() q: DoctorScopeQuery) {
    return this.service.get(u, q.doctorId);
  }

  @Put('schedule')
  replace(@CurrentUser() u: AuthUser, @Body() dto: ReplaceScheduleDto, @Query() q: DoctorScopeQuery) {
    return this.service.replace(u, dto, q.doctorId);
  }

  @Post('exceptions')
  addException(@CurrentUser() u: AuthUser, @Body() dto: ExceptionDto, @Query() q: DoctorScopeQuery) {
    return this.service.addException(u, dto, q.doctorId);
  }

  @Delete('exceptions/:id')
  deleteException(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: DoctorScopeQuery) {
    return this.service.deleteException(u, id, q.doctorId);
  }

  @Post('slot-blocks')
  addBlock(@CurrentUser() u: AuthUser, @Body() dto: SlotBlockDto, @Query() q: DoctorScopeQuery) {
    return this.service.addSlotBlock(u, dto, q.doctorId);
  }

  @Delete('slot-blocks/:id')
  deleteBlock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: DoctorScopeQuery) {
    return this.service.deleteSlotBlock(u, id, q.doctorId);
  }
}
