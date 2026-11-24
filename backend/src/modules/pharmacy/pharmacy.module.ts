import { Global, Module } from '@nestjs/common';
import { PharmacyCatalogService } from './pharmacy-catalog.service';
import { PharmacyOrdersService } from './pharmacy-orders.service';
import { MedicinesAdminController, PharmacyOrdersController, PharmacyPublicController, PharmacyWorkspaceController } from './pharmacy.controller';

@Global()
@Module({
  providers: [PharmacyCatalogService, PharmacyOrdersService],
  controllers: [PharmacyPublicController, PharmacyWorkspaceController, PharmacyOrdersController, MedicinesAdminController],
  exports: [PharmacyCatalogService, PharmacyOrdersService],
})
export class PharmacyModule {}
