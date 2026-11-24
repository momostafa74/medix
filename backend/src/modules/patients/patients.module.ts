import { Module } from '@nestjs/common';
import { PatientsController, PatientSelfController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  providers: [PatientsService],
  controllers: [PatientSelfController, PatientsController],
})
export class PatientsModule {}
