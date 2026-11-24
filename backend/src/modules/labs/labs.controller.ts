import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { LabCatalogService } from './lab-catalog.service';
import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';
import { LabDashboardService } from './lab-dashboard.service';
import {
  BookLabOrderDto,
  BranchHoursDto,
  CatalogTestsQuery,
  CategoryDto,
  DashboardRangeQuery,
  LabCancelDto,
  LabOrdersQuery,
  LabPaymentDto,
  LabStatusDto,
  PackageDto,
  PackageVisibilityDto,
  RejectSampleDto,
  ReturnResultsDto,
  ReviewNoteDto,
  SaveResultsDto,
  SearchTestsQuery,
  SlotsQuery,
  TestDto,
  UpdateLabSettingsDto,
} from './labs.dto';

const LAB_STAFF = [P.LAB_ORDERS_MANAGE, P.LAB_RESULTS_ENTER, P.LAB_RESULTS_REVIEW, P.LAB_RESULTS_APPROVE, P.LAB_CATALOG_MANAGE] as const;

// ───────────────────────── Public catalog ─────────────────────────
@ApiTags('Laboratories — public')
@Controller()
export class LabsPublicController {
  constructor(
    private catalog: LabCatalogService,
    private orders: LabOrdersService,
  ) {}

  @Public()
  @Get('lab-tests/search')
  @ApiOperation({ summary: 'Search tests across labs and compare prices (grouped by test code)' })
  search(@Query() q: SearchTestsQuery) {
    return this.catalog.searchTests(q);
  }

  @Public()
  @Get('labs/:key/catalog')
  @ApiOperation({ summary: 'Public catalog of an approved lab (tests, packages, branches)' })
  catalogOf(@Param('key') key: string) {
    return this.catalog.publicCatalog(key);
  }

  @Public()
  @Get('labs/:key/slots')
  @ApiOperation({ summary: 'Bookable windows for a day (branch visit or home collection), with remaining capacity' })
  slots(@Param('key') key: string, @Query() q: SlotsQuery) {
    return this.orders.slots(key, q);
  }

}

// ───────────────────────── Lab workspace (/labs/me) ─────────────────────────
@ApiTags('Laboratories — lab workspace')
@ApiBearerAuth()
@Controller('labs/me')
export class LabWorkspaceController {
  constructor(
    private catalog: LabCatalogService,
    private orders: LabOrdersService,
    private dashboard: LabDashboardService,
  ) {}

  @Get()
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  settings(@CurrentUser() u: AuthUser) {
    return this.catalog.mySettings(u);
  }

  @Patch()
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  updateSettings(@CurrentUser() u: AuthUser, @Body() dto: UpdateLabSettingsDto) {
    return this.catalog.updateSettings(u, dto);
  }

  @Put('branches/:branchId/hours')
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  branchHours(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: BranchHoursDto) {
    return this.catalog.setBranchHours(u, id, dto.openingHours);
  }

  @Get('dashboard')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  stats(@CurrentUser() u: AuthUser, @Query() q: DashboardRangeQuery) {
    return this.dashboard.dashboard(u, q.from, q.to);
  }

  @Get('orders')
  @RequireAnyPermission(...LAB_STAFF)
  list(@CurrentUser() u: AuthUser, @Query() q: LabOrdersQuery) {
    return this.orders.list(u, 'lab', q);
  }

  // Catalog
  @Get('categories')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  categories(@CurrentUser() u: AuthUser) {
    return this.catalog.myCategories(u);
  }

  @Post('categories')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  addCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) {
    return this.catalog.addCategory(u, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto) {
    return this.catalog.updateCategory(u, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  deleteCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteCategory(u, id);
  }

  @Get('tests')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  tests(@CurrentUser() u: AuthUser, @Query() q: CatalogTestsQuery) {
    return this.catalog.myTests(u, q);
  }

  @Get('tests/:id')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  test(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.myTest(u, id);
  }

  @Post('tests')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  createTest(@CurrentUser() u: AuthUser, @Body() dto: TestDto) {
    return this.catalog.createTest(u, dto);
  }

  @Put('tests/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  updateTest(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestDto) {
    return this.catalog.updateTest(u, id, dto);
  }

  @Delete('tests/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  deleteTest(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteTest(u, id);
  }

  @Get('packages')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  packages(@CurrentUser() u: AuthUser) {
    return this.catalog.myPackages(u);
  }

  @Post('packages')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  createPackage(@CurrentUser() u: AuthUser, @Body() dto: PackageDto) {
    return this.catalog.createPackage(u, dto);
  }

  @Put('packages/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  updatePackage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PackageDto) {
    return this.catalog.updatePackage(u, id, dto);
  }

  @Delete('packages/:id')
  @RequirePermissions(P.LAB_CATALOG_MANAGE)
  deletePackage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deletePackage(u, id);
  }
}

// ───────────────────────── Orders (patient + lab + platform) ─────────────────────────
@ApiTags('Laboratories — orders')
@ApiBearerAuth()
@Controller('lab-orders')
export class LabOrdersController {
  constructor(
    private orders: LabOrdersService,
    private results: LabResultsService,
  ) {}

  @Post()
  @RequirePermissions(P.LAB_ORDERS_BOOK)
  @ApiOperation({ summary: 'Book lab tests/packages (branch visit or home collection). Prices are taken from the database.' })
  book(@CurrentUser() u: AuthUser, @Body() dto: BookLabOrderDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.book(u, dto, meta);
  }

  @Get('mine')
  @RequirePermissions(P.LAB_ORDERS_BOOK)
  mine(@CurrentUser() u: AuthUser, @Query() q: LabOrdersQuery) {
    return this.orders.list(u, 'patient', q);
  }

  @Get('admin')
  @RequirePermissions(P.LAB_ORDERS_READ_ANY)
  @ApiOperation({ summary: 'Platform view — order metadata only, never result values' })
  admin(@CurrentUser() u: AuthUser, @Query() q: LabOrdersQuery) {
    return this.orders.list(u, 'admin', q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(u, id);
  }

  @Post(':id/status')
  @RequirePermissions(P.LAB_ORDERS_MANAGE)
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LabStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.changeStatus(u, id, dto, meta);
  }

  @Post(':id/payment')
  @RequirePermissions(P.LAB_ORDERS_MANAGE)
  payment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LabPaymentDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.recordPayment(u, id, dto.paymentMethod, meta);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LabCancelDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.cancel(u, id, dto.reason, meta);
  }

  @Post(':id/samples/:sampleId/reject')
  @RequirePermissions(P.LAB_ORDERS_MANAGE)
  rejectSample(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sampleId', ParseUUIDPipe) sampleId: string,
    @Body() dto: RejectSampleDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.orders.rejectSample(u, id, sampleId, dto.reason, meta);
  }

  // Results
  @Get(':id/worksheet')
  @RequireAnyPermission(...LAB_STAFF)
  worksheet(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.results.worksheet(u, id);
  }

  @Put(':id/results')
  @RequirePermissions(P.LAB_RESULTS_ENTER)
  save(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveResultsDto, @ReqMeta() meta: RequestMeta) {
    return this.results.save(u, id, dto, meta);
  }

  @Post(':id/results/submit')
  @RequirePermissions(P.LAB_RESULTS_ENTER)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.results.submitForReview(u, id, meta);
  }

  @Post(':id/results/review')
  @RequirePermissions(P.LAB_RESULTS_REVIEW)
  review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewNoteDto, @ReqMeta() meta: RequestMeta) {
    return this.results.markReviewed(u, id, dto.note, meta);
  }

  @Post(':id/results/return')
  @RequirePermissions(P.LAB_RESULTS_REVIEW)
  returnResults(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnResultsDto, @ReqMeta() meta: RequestMeta) {
    return this.results.returnForCorrection(u, id, dto.note, meta);
  }

  @Post(':id/results/approve')
  @RequirePermissions(P.LAB_RESULTS_APPROVE)
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.results.approve(u, id, meta);
  }

  @Post(':id/deliver')
  @RequirePermissions(P.LAB_ORDERS_MANAGE)
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.results.markDelivered(u, id, meta);
  }

  @Get(':id/results')
  resultsOf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.results.results(u, id, meta).then(({ result: _r, ...rest }) => rest);
  }

  @Get(':id/report.pdf')
  @ApiOperation({ summary: 'Professional Arabic PDF report (final once approved; watermarked draft for lab staff before)' })
  async report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { buffer, fileName } = await this.results.report(u, id, meta);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(buffer);
  }
}

// ───────────────────────── Other entry points ─────────────────────────
@ApiTags('Laboratories — records & admin')
@ApiBearerAuth()
@Controller()
export class LabRecordsController {
  constructor(
    private results: LabResultsService,
    private catalog: LabCatalogService,
  ) {}

  @Get('patients/:patientId/lab-results')
  @ApiOperation({ summary: 'Approved lab results of a patient (patient themself or a provider with a care relationship)' })
  history(@CurrentUser() u: AuthUser, @Param('patientId', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.results.patientHistory(u, id, meta);
  }

  @Get('admin/labs/:providerId/catalog')
  @RequirePermissions(P.PROVIDERS_READ_ANY)
  adminCatalog(@Param('providerId', ParseUUIDPipe) id: string) {
    return this.catalog.adminLabCatalog(id);
  }

  @Patch('admin/lab-packages/:id/visibility')
  @RequirePermissions(P.PROVIDERS_MANAGE_ANY)
  visibility(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PackageVisibilityDto) {
    return this.catalog.setPackageVisibility(u, id, dto.isVisible);
  }
}
