import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { BranchHoursDto } from '../labs/labs.dto';
import { RadiologyCatalogService } from './radiology-catalog.service';
import { RadiologyOrdersService } from './radiology-orders.service';
import { RadiologyReportsService } from './radiology-reports.service';
import {
  AttachFileDto,
  BookRadiologyDto,
  BranchModalitiesDto,
  PacsDto,
  RadCancelDto,
  RadDashboardQuery,
  RadiologyServiceDto,
  RadOrdersQuery,
  RadPaymentDto,
  RadSlotsQuery,
  RadStatusDto,
  ReturnReportDto,
  SaveReportDto,
  SearchServicesQuery,
  UpdateCenterSettingsDto,
  WorklistQuery,
} from './radiology.dto';

const CENTER_STAFF = [P.RADIOLOGY_ORDERS_MANAGE, P.RADIOLOGY_REPORTS_WRITE, P.RADIOLOGY_REPORTS_APPROVE, P.RADIOLOGY_CATALOG_MANAGE] as const;

@ApiTags('Radiology — public')
@Controller()
export class RadiologyPublicController {
  constructor(
    private catalog: RadiologyCatalogService,
    private orders: RadiologyOrdersService,
  ) {}

  @Public()
  @Get('radiology-services/search')
  @ApiOperation({ summary: 'Search radiology services across approved centers (cheapest first)' })
  search(@Query() q: SearchServicesQuery) {
    return this.catalog.searchServices(q);
  }

  @Public()
  @Get('radiology/:key/catalog')
  catalogOf(@Param('key') key: string) {
    return this.catalog.publicCatalog(key);
  }

  @Public()
  @Get('radiology/:key/slots')
  @ApiOperation({ summary: 'Exam start times for a service at a branch, with remaining machine capacity' })
  slots(@Param('key') key: string, @Query() q: RadSlotsQuery) {
    return this.orders.slots(key, q);
  }
}

@ApiTags('Radiology — center workspace')
@ApiBearerAuth()
@Controller('radiology-center/me')
export class RadiologyWorkspaceController {
  constructor(
    private catalog: RadiologyCatalogService,
    private orders: RadiologyOrdersService,
    private reports: RadiologyReportsService,
  ) {}

  @Get()
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  settings(@CurrentUser() u: AuthUser) {
    return this.catalog.mySettings(u);
  }

  @Patch()
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateCenterSettingsDto) {
    return this.catalog.updateSettings(u, dto);
  }

  @Put('branches/:branchId/hours')
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  hours(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: BranchHoursDto) {
    return this.catalog.setBranchHours(u, id, dto.openingHours);
  }

  @Put('branches/:branchId/modalities')
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  @ApiOperation({ summary: 'Machines per modality in a branch (booking capacity)' })
  modalities(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: BranchModalitiesDto) {
    return this.catalog.setBranchModalities(u, id, dto.modalities);
  }

  @Get('dashboard')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  dashboard(@CurrentUser() u: AuthUser, @Query() q: RadDashboardQuery) {
    return this.reports.dashboard(u, q.from, q.to);
  }

  @Get('orders')
  @RequireAnyPermission(...CENTER_STAFF)
  list(@CurrentUser() u: AuthUser, @Query() q: RadOrdersQuery) {
    return this.orders.list(u, 'center', q);
  }

  @Get('worklist')
  @RequireAnyPermission(P.RADIOLOGY_ORDERS_MANAGE, P.RADIOLOGY_REPORTS_WRITE)
  @ApiOperation({ summary: 'DICOM Modality Worklist feed (JSON, PS3.4 attribute names) for a future PACS/RIS bridge' })
  worklist(@CurrentUser() u: AuthUser, @Query() q: WorklistQuery) {
    return this.orders.worklist(u, q);
  }

  @Get('services')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER)
  services(@CurrentUser() u: AuthUser, @Query() q: SearchServicesQuery) {
    return this.catalog.myServices(u, q);
  }

  @Post('services')
  @RequirePermissions(P.RADIOLOGY_CATALOG_MANAGE)
  createService(@CurrentUser() u: AuthUser, @Body() dto: RadiologyServiceDto) {
    return this.catalog.createService(u, dto);
  }

  @Put('services/:id')
  @RequirePermissions(P.RADIOLOGY_CATALOG_MANAGE)
  updateService(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RadiologyServiceDto) {
    return this.catalog.updateService(u, id, dto);
  }

  @Delete('services/:id')
  @RequirePermissions(P.RADIOLOGY_CATALOG_MANAGE)
  deleteService(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteService(u, id);
  }
}

@ApiTags('Radiology — bookings')
@ApiBearerAuth()
@Controller('radiology-orders')
export class RadiologyOrdersController {
  constructor(
    private orders: RadiologyOrdersService,
    private reports: RadiologyReportsService,
  ) {}

  @Post()
  @RequirePermissions(P.RADIOLOGY_ORDERS_BOOK)
  @ApiOperation({ summary: 'Book a radiology exam. Price and end time come from the service; capacity per branch machine.' })
  book(@CurrentUser() u: AuthUser, @Body() dto: BookRadiologyDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.book(u, dto, meta);
  }

  @Get('mine')
  @RequirePermissions(P.RADIOLOGY_ORDERS_BOOK)
  mine(@CurrentUser() u: AuthUser, @Query() q: RadOrdersQuery) {
    return this.orders.list(u, 'patient', q);
  }

  @Get('admin')
  @RequirePermissions(P.RADIOLOGY_ORDERS_READ_ANY)
  admin(@CurrentUser() u: AuthUser, @Query() q: RadOrdersQuery) {
    return this.orders.list(u, 'admin', q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(u, id);
  }

  @Post(':id/status')
  @RequirePermissions(P.RADIOLOGY_ORDERS_MANAGE)
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RadStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.changeStatus(u, id, dto, meta);
  }

  @Post(':id/payment')
  @RequirePermissions(P.RADIOLOGY_ORDERS_MANAGE)
  payment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RadPaymentDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.recordPayment(u, id, dto.paymentMethod, meta);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RadCancelDto, @ReqMeta() meta: RequestMeta) {
    return this.orders.cancel(u, id, dto.reason, meta);
  }

  @Post(':id/files')
  @RequirePermissions(P.RADIOLOGY_REPORTS_WRITE)
  attach(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachFileDto) {
    return this.orders.attachFile(u, id, dto.fileId, dto.caption);
  }

  @Delete(':id/files/:attachmentId')
  @RequirePermissions(P.RADIOLOGY_REPORTS_WRITE)
  detach(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) a: string) {
    return this.orders.removeFile(u, id, a);
  }

  @Patch(':id/pacs')
  @RequirePermissions(P.RADIOLOGY_REPORTS_WRITE)
  pacs(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PacsDto) {
    return this.orders.setPacs(u, id, dto.pacsUrl);
  }

  @Put(':id/report')
  @RequirePermissions(P.RADIOLOGY_REPORTS_WRITE)
  saveReport(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveReportDto, @ReqMeta() meta: RequestMeta) {
    return this.reports.save(u, id, dto, meta);
  }

  @Post(':id/report/submit')
  @RequirePermissions(P.RADIOLOGY_REPORTS_WRITE)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.reports.submit(u, id, meta);
  }

  @Post(':id/report/return')
  @RequirePermissions(P.RADIOLOGY_REPORTS_APPROVE)
  returnReport(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnReportDto, @ReqMeta() meta: RequestMeta) {
    return this.reports.returnForCorrection(u, id, dto.note, meta);
  }

  @Post(':id/report/approve')
  @RequirePermissions(P.RADIOLOGY_REPORTS_APPROVE)
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.reports.approve(u, id, meta);
  }

  @Post(':id/report/viewed')
  @ApiOperation({ summary: "Patient opened the approved report (marks the booking delivered)" })
  viewed(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.reports.markViewed(u, id, meta);
  }

  @Get(':id/report.pdf')
  async pdf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const { buffer, fileName } = await this.reports.report(u, id, meta);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
    res.end(buffer);
  }
}

@ApiTags('Radiology — records & admin')
@ApiBearerAuth()
@Controller()
export class RadiologyRecordsController {
  constructor(
    private reports: RadiologyReportsService,
    private catalog: RadiologyCatalogService,
  ) {}

  @Get('patients/:patientId/radiology-reports')
  history(@CurrentUser() u: AuthUser, @Param('patientId', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.reports.patientHistory(u, id, meta);
  }

  @Get('admin/radiology/:providerId/catalog')
  @RequirePermissions(P.PROVIDERS_READ_ANY)
  adminCatalog(@Param('providerId', ParseUUIDPipe) id: string) {
    return this.catalog.adminCatalog(id);
  }
}
