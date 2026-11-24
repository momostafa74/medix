import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { BranchHoursDto } from '../labs/labs.dto';
import { PharmacyCatalogService } from './pharmacy-catalog.service';
import { PharmacyOrdersService } from './pharmacy-orders.service';
import {
  AdminMedicineDto,
  AdminMedicinesQuery,
  ConfirmOrderDto,
  InventoryItemDto,
  InventoryQuery,
  MedicineSearchQuery,
  NewMedicineInventoryDto,
  PharmacyCancelDto,
  PharmacyDashboardQuery,
  PharmacyOrdersQuery,
  PharmacyStatusDto,
  PlaceOrderDto,
  PublicCatalogQuery,
  UpdateInventoryDto,
  UpdateMedicineDto,
  UpdatePharmacySettingsDto,
} from './pharmacy.dto';

const PHARMACY_STAFF = [P.PHARMACY_ORDERS_MANAGE, P.PHARMACY_CATALOG_MANAGE, P.PRESCRIPTIONS_VERIFY] as const;

@ApiTags('Pharmacy — public')
@Controller()
export class PharmacyPublicController {
  constructor(private catalog: PharmacyCatalogService) {}

  @Public()
  @Get('medicines/search')
  @ApiOperation({ summary: 'Search medicines & products, with number of pharmacies offering each and the price range' })
  search(@Query() q: MedicineSearchQuery) {
    return this.catalog.searchMedicines(q);
  }

  @Public()
  @Get('medicines/categories')
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('medicines/:id')
  @ApiOperation({ summary: 'A medicine with every pharmacy offering it (compare prices) and same-ingredient alternatives' })
  offers(@Param('id', ParseUUIDPipe) id: string, @Query('cityId') cityId?: string) {
    return this.catalog.medicineOffers(id, cityId && /^[0-9a-f-]{36}$/i.test(cityId) ? cityId : undefined);
  }

  @Public()
  @Get('pharmacies/:key/profile')
  profile(@Param('key') key: string) {
    return this.catalog.publicProfile(key);
  }

  @Public()
  @Get('pharmacies/:key/items')
  items(@Param('key') key: string, @Query() q: PublicCatalogQuery) {
    return this.catalog.publicItems(key, q);
  }
}

@ApiTags('Pharmacy — workspace')
@ApiBearerAuth()
@Controller('pharmacy/me')
export class PharmacyWorkspaceController {
  constructor(
    private catalog: PharmacyCatalogService,
    private orders: PharmacyOrdersService,
  ) {}

  @Get()
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  settings(@CurrentUser() u: AuthUser) {
    return this.catalog.mySettings(u);
  }

  @Patch()
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdatePharmacySettingsDto) {
    return this.catalog.updateSettings(u, dto);
  }

  @Put('branches/:branchId/hours')
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  hours(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: BranchHoursDto) {
    return this.catalog.setBranchHours(u, id, dto.openingHours);
  }

  @Get('dashboard')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  dashboard(@CurrentUser() u: AuthUser, @Query() q: PharmacyDashboardQuery) {
    return this.orders.dashboard(u, q.from, q.to);
  }

  @Get('orders')
  @RequireAnyPermission(...PHARMACY_STAFF)
  list(@CurrentUser() u: AuthUser, @Query() q: PharmacyOrdersQuery) {
    return this.orders.list(u, 'pharmacy', q);
  }

  @Get('inventory')
  @RequireAnyPermission(...PHARMACY_STAFF)
  inventory(@CurrentUser() u: AuthUser, @Query() q: InventoryQuery) {
    return this.catalog.myInventory(u, q);
  }

  @Post('inventory')
  @RequirePermissions(P.PHARMACY_CATALOG_MANAGE)
  @ApiOperation({ summary: 'List a catalog medicine/product with your price and stock' })
  addInventory(@CurrentUser() u: AuthUser, @Body() dto: InventoryItemDto) {
    return this.catalog.addInventory(u, dto);
  }

  @Post('inventory/new-medicine')
  @RequirePermissions(P.PHARMACY_CATALOG_MANAGE)
  @ApiOperation({ summary: 'Add a medicine missing from the shared catalog (deduplicated) and list it' })
  addNew(@CurrentUser() u: AuthUser, @Body() dto: NewMedicineInventoryDto) {
    return this.catalog.addNewMedicine(u, dto);
  }

  @Patch('inventory/:id')
  @RequireAnyPermission(P.PHARMACY_CATALOG_MANAGE, P.PHARMACY_ORDERS_MANAGE)
  @ApiOperation({ summary: 'Update price (managers) or stock (staff)' })
  updateInventory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryDto) {
    return this.catalog.updateInventory(u, id, dto);
  }

  @Delete('inventory/:id')
  @RequirePermissions(P.PHARMACY_CATALOG_MANAGE)
  removeInventory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeInventory(u, id);
  }
}

@ApiTags('Pharmacy — orders')
@ApiBearerAuth()
@Controller('pharmacy-orders')
export class PharmacyOrdersController {
  constructor(private orders: PharmacyOrdersService) {}

  @Post()
  @RequirePermissions(P.PHARMACY_ORDERS_PLACE)
  @ApiOperation({ summary: 'Place an order. Prices come from the pharmacy inventory; prescription-only items need an e-prescription or an uploaded one.' })
  place(@CurrentUser() u: AuthUser, @Body() dto: PlaceOrderDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.place(u, dto, meta);
  }

  @Get('mine')
  @RequirePermissions(P.PHARMACY_ORDERS_PLACE)
  mine(@CurrentUser() u: AuthUser, @Query() q: PharmacyOrdersQuery) {
    return this.orders.list(u, 'patient', q);
  }

  @Get('prescription-offers/:prescriptionId')
  @RequirePermissions(P.PHARMACY_ORDERS_PLACE)
  @ApiOperation({ summary: 'Compare pharmacies for a whole e-prescription: availability and price of the prescribed quantities' })
  rxOffers(@CurrentUser() u: AuthUser, @Param('prescriptionId', ParseUUIDPipe) id: string, @Query('cityId') cityId?: string) {
    return this.orders.prescriptionOffers(u, id, cityId && /^[0-9a-f-]{36}$/i.test(cityId) ? cityId : undefined);
  }

  @Get('admin')
  @RequirePermissions(P.PHARMACY_ORDERS_READ_ANY)
  @ApiOperation({ summary: 'Platform oversight — metadata only, never the medicines' })
  admin(@CurrentUser() u: AuthUser, @Query() q: PharmacyOrdersQuery) {
    return this.orders.list(u, 'admin', q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(u, id);
  }

  @Post(':id/confirm')
  @RequirePermissions(P.PHARMACY_ORDERS_MANAGE)
  @ApiOperation({ summary: 'Confirm / price the order and reserve stock atomically' })
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmOrderDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.confirm(u, id, dto, meta);
  }

  @Post(':id/status')
  @RequirePermissions(P.PHARMACY_ORDERS_MANAGE)
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PharmacyStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.changeStatus(u, id, dto, meta);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PharmacyCancelDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.cancel(u, id, dto.reason, meta);
  }
}

@ApiTags('Pharmacy — admin')
@ApiBearerAuth()
@Controller('admin/medicines')
export class MedicinesAdminController {
  constructor(private catalog: PharmacyCatalogService) {}

  @Get()
  @RequirePermissions(P.MEDICINES_MANAGE)
  list(@Query() q: AdminMedicinesQuery) {
    return this.catalog.adminList(q);
  }

  @Post()
  @RequirePermissions(P.MEDICINES_MANAGE)
  create(@CurrentUser() u: AuthUser, @Body() dto: AdminMedicineDto) {
    return this.catalog.adminCreate(u, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.MEDICINES_MANAGE)
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMedicineDto) {
    return this.catalog.adminUpdate(u, id, dto);
  }
}
