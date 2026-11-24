import { Global, Module } from '@nestjs/common';
import { RadiologyCatalogService } from './radiology-catalog.service';
import { RadiologyOrdersService } from './radiology-orders.service';
import { RadiologyReportsService } from './radiology-reports.service';
import { RadiologyOrdersController, RadiologyPublicController, RadiologyRecordsController, RadiologyWorkspaceController } from './radiology.controller';

@Global()
@Module({
  providers: [RadiologyCatalogService, RadiologyOrdersService, RadiologyReportsService],
  controllers: [RadiologyPublicController, RadiologyWorkspaceController, RadiologyOrdersController, RadiologyRecordsController],
  exports: [RadiologyOrdersService, RadiologyReportsService],
})
export class RadiologyModule {}
