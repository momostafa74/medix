import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto, DispenseDto, PrescriptionsQuery, RevokeDto, RxLookupDto } from './prescriptions.dto';

@ApiTags('Prescriptions')
@ApiBearerAuth()
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private rx: PrescriptionsService) {}

  @Post()
  @RequirePermissions(P.PRESCRIPTIONS_WRITE)
  @ApiOperation({ summary: 'Doctor issues an e-prescription (needs a care relationship with the patient)' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePrescriptionDto, @ReqMeta() meta: RequestMeta) {
    return this.rx.create(u, dto, meta);
  }

  @Get('mine')
  @ApiOperation({ summary: "Patient's own prescriptions" })
  mine(@CurrentUser() u: AuthUser, @Query() q: PrescriptionsQuery) {
    return this.rx.list(u, 'patient', q);
  }

  @Get('written')
  @RequirePermissions(P.PRESCRIPTIONS_WRITE)
  @ApiOperation({ summary: 'Prescriptions written by the current doctor' })
  written(@CurrentUser() u: AuthUser, @Query() q: PrescriptionsQuery) {
    return this.rx.list(u, 'doctor', q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.rx.get(u, id, meta);
  }

  @Post(':id/revoke')
  @RequirePermissions(P.PRESCRIPTIONS_WRITE)
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @ReqMeta() meta: RequestMeta) {
    return this.rx.revoke(u, id, dto.reason, meta);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Printable A5 prescription with QR (void watermark once dispensed / revoked / expired)' })
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { buffer, fileName } = await this.rx.pdfFor(u, id, meta);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
    res.end(buffer);
  }
}

@ApiTags('Prescriptions')
@ApiBearerAuth()
@Controller()
export class PrescriptionsPharmacyController {
  constructor(private rx: PrescriptionsService) {}

  @Post('pharmacy-prescriptions/lookup')
  @RequirePermissions(P.PRESCRIPTIONS_VERIFY)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pharmacist opens a prescription by QR code (or number + patient phone). Audited.' })
  lookup(@CurrentUser() u: AuthUser, @Body() dto: RxLookupDto, @ReqMeta() meta: RequestMeta) {
    return this.rx.pharmacyLookup(u, dto, meta);
  }

  @Post('pharmacy-prescriptions/dispense')
  @RequirePermissions(P.PRESCRIPTIONS_VERIFY)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record dispensing — atomic, a prescription can be dispensed only once' })
  dispense(@CurrentUser() u: AuthUser, @Body() dto: DispenseDto, @ReqMeta() meta: RequestMeta) {
    return this.rx.dispense(u, dto, meta);
  }

  @Get('patients/:patientId/prescriptions')
  @ApiOperation({ summary: "Prescriptions in a patient's medical record" })
  history(@CurrentUser() u: AuthUser, @Param('patientId', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.rx.patientHistory(u, id, meta);
  }
}
