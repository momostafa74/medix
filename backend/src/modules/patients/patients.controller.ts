import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentUser, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PatientsService } from './patients.service';
import { AddMedicalDocumentDto, GrantAccessDto, RecordNotesDto, UpdatePatientDto } from './patients.dto';

@ApiTags('Patients — self')
@ApiBearerAuth()
@Controller('patients/me')
@RequirePermissions(P.PATIENT_PROFILE_OWN)
export class PatientSelfController {
  constructor(private service: PatientsService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.service.me(u);
  }

  @Patch()
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdatePatientDto) {
    return this.service.updateMe(u, dto);
  }

  @Get('medical-record')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  record(@CurrentUser() u: AuthUser) {
    return this.service.myRecord(u);
  }

  @Put('medical-record/notes')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  notes(@CurrentUser() u: AuthUser, @Body() dto: RecordNotesDto) {
    return this.service.setRecordNotes(u, dto.notes);
  }

  @Post('medical-record/:section')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  @ApiBody({ description: 'allergies | conditions | medications | surgeries — see DTOs' })
  addItem(@CurrentUser() u: AuthUser, @Param('section') section: string, @Body() body: Record<string, unknown>) {
    return this.service.addItem(u, section, body);
  }

  @Patch('medical-record/:section/:id')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  updateItem(@CurrentUser() u: AuthUser, @Param('section') section: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.service.updateItem(u, section, id, body);
  }

  @Delete('medical-record/:section/:id')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  deleteItem(@CurrentUser() u: AuthUser, @Param('section') section: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteItem(u, section, id);
  }

  @Post('documents')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  addDoc(@CurrentUser() u: AuthUser, @Body() dto: AddMedicalDocumentDto) {
    return this.service.addDocument(u, dto);
  }

  @Delete('documents/:id')
  @RequirePermissions(P.MEDICAL_RECORD_OWN)
  delDoc(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteDocument(u, id);
  }

  @Get('access-grants')
  grants(@CurrentUser() u: AuthUser) {
    return this.service.listGrants(u);
  }

  @Post('access-grants')
  grant(@CurrentUser() u: AuthUser, @Body() dto: GrantAccessDto) {
    return this.service.grant(u, dto);
  }

  @Delete('access-grants/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.revokeGrant(u, id);
  }
}

@ApiTags('Patients — providers & admin')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private service: PatientsService) {}

  @Get()
  @RequireAnyPermission(P.APPOINTMENTS_READ_PROVIDER, P.PATIENTS_READ_ANY)
  list(@CurrentUser() u: AuthUser, @Query() q: PaginationQueryDto) {
    return this.service.list(u, q);
  }

  /** Never returns a patient just because the id is valid — relationship is verified server-side. */
  @Get(':id')
  @RequireAnyPermission(P.APPOINTMENTS_READ_PROVIDER, P.PATIENTS_READ_ANY)
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.service.getForProvider(u, id, meta);
  }

  @Get(':id/medical-record')
  @RequirePermissions(P.MEDICAL_RECORD_READ_PATIENT)
  record(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.service.medicalRecordForProvider(u, id, meta);
  }
}
