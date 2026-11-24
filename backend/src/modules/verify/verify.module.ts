import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { LabResultsService } from '../labs/lab-results.service';
import { RadiologyReportsService } from '../radiology/radiology-reports.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';

/**
 * Public QR landing endpoint for every document type. Codes are random and
 * unguessable; the answer confirms authenticity only (issuer, number, date,
 * patient initials) and never exposes medical content.
 */
@ApiTags('Verification')
@Controller('verify')
export class VerifyController {
  constructor(
    private labs: LabResultsService,
    private radiology: RadiologyReportsService,
    private prescriptions: PrescriptionsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':code')
  @ApiOperation({ summary: 'Public document verification (lab & radiology reports, prescriptions) — authenticity only' })
  async verify(@Param('code') code: string) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return { valid: false };
    const lab = await this.labs.verify(code);
    if (lab.valid) return lab;
    const rad = await this.radiology.verify(code);
    if (rad) return rad;
    return (await this.prescriptions.verify(code)) ?? { valid: false };
  }
}

@Module({ controllers: [VerifyController] })
export class VerifyModule {}
