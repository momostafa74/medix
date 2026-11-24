import { Global, Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController, PrescriptionsPharmacyController } from './prescriptions.controller';

@Global()
@Module({
  providers: [PrescriptionsService],
  controllers: [PrescriptionsController, PrescriptionsPharmacyController],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
