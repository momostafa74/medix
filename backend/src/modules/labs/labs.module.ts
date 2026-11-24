import { Global, Module } from '@nestjs/common';
import { LabCatalogService } from './lab-catalog.service';
import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';
import { LabDashboardService } from './lab-dashboard.service';
import { LabOrdersController, LabRecordsController, LabWorkspaceController, LabsPublicController } from './labs.controller';

@Global()
@Module({
  providers: [LabCatalogService, LabOrdersService, LabResultsService, LabDashboardService],
  controllers: [LabsPublicController, LabWorkspaceController, LabOrdersController, LabRecordsController],
  exports: [LabResultsService, LabOrdersService],
})
export class LabsModule {}
