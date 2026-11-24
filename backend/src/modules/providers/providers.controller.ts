import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowUnsubscribed, CurrentUser, Public, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ProvidersService } from './providers.service';
import { ProviderStaffService } from './staff.service';
import {
  AddDocumentDto,
  AdminProvidersQuery,
  BranchDto,
  CreateStaffDto,
  UpdateStaffDto,
  ProviderStatusDto,
  PublicProvidersQuery,
  ServiceDto,
  UpdateBranchDto,
  UpdateProviderDto,
  UpdateServiceDto,
} from './providers.dto';

@ApiTags('Providers')
@Controller('providers')
export class ProvidersController {
  constructor(
    private service: ProvidersService,
    private staff: ProviderStaffService,
  ) {}

  // Team
  @ApiBearerAuth()
  @Get(':id/staff')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  listStaff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.list(u, id);
  }

  @ApiBearerAuth()
  @Post(':id/staff')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  addStaff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateStaffDto) {
    return this.staff.create(u, id, dto);
  }

  @ApiBearerAuth()
  @Patch(':id/staff/:staffId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  updateStaff(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('staffId', ParseUUIDPipe) staffId: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(u, id, staffId, dto);
  }

  @Public()
  @Get()
  search(@Query() q: PublicProvidersQuery) {
    return this.service.searchPublic(q);
  }

  @ApiBearerAuth()
  @Get('mine')
  @AllowUnsubscribed()
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.DASHBOARD_PROVIDER)
  mine(@CurrentUser() u: AuthUser) {
    return this.service.mine(u);
  }

  @Public()
  @Get(':idOrSlug')
  get(@Param('idOrSlug') key: string, @CurrentUser() u?: AuthUser) {
    return this.service.getPublic(key, u);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto) {
    return this.service.update(u, id, dto);
  }

  // Branches
  @ApiBearerAuth()
  @Get(':id/branches')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  branches(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listBranches(u, id);
  }

  @ApiBearerAuth()
  @Post(':id/branches')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  addBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchDto) {
    return this.service.addBranch(u, id, dto);
  }

  @ApiBearerAuth()
  @Patch(':id/branches/:branchId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  updateBranch(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.service.updateBranch(u, id, branchId, dto);
  }

  @ApiBearerAuth()
  @Delete(':id/branches/:branchId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  deleteBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.service.deleteBranch(u, id, branchId);
  }

  // Services
  @ApiBearerAuth()
  @Get(':id/services')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  services(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listServices(u, id);
  }

  @ApiBearerAuth()
  @Post(':id/services')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  addService(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ServiceDto) {
    return this.service.addService(u, id, dto);
  }

  @ApiBearerAuth()
  @Patch(':id/services/:serviceId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  updateService(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.service.updateService(u, id, serviceId, dto);
  }

  @ApiBearerAuth()
  @Delete(':id/services/:serviceId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  deleteService(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('serviceId', ParseUUIDPipe) serviceId: string) {
    return this.service.deleteService(u, id, serviceId);
  }

  // Verification documents
  @ApiBearerAuth()
  @Get(':id/documents')
  documents(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listDocuments(u, id);
  }

  @ApiBearerAuth()
  @Post(':id/documents')
  @RequirePermissions(P.PROVIDER_MANAGE_OWN)
  addDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDocumentDto) {
    return this.service.addDocument(u, id, dto);
  }

  @ApiBearerAuth()
  @Delete(':id/documents/:documentId')
  @RequireAnyPermission(P.PROVIDER_MANAGE_OWN, P.PROVIDERS_MANAGE_ANY)
  deleteDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.deleteDocument(u, id, documentId);
  }
}

@ApiTags('Admin — providers')
@ApiBearerAuth()
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private service: ProvidersService) {}

  @Get()
  @RequirePermissions(P.PROVIDERS_READ_ANY)
  list(@Query() q: AdminProvidersQuery) {
    return this.service.adminList(q);
  }

  @Get(':id')
  @RequirePermissions(P.PROVIDERS_READ_ANY)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.adminGet(id);
  }

  @Patch(':id/status')
  @RequirePermissions(P.PROVIDERS_APPROVE)
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderStatusDto) {
    return this.service.changeStatus(u, id, dto);
  }

  @Patch(':id/documents/:documentId/verify')
  @RequirePermissions(P.PROVIDERS_APPROVE)
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.verifyDocument(u, id, documentId);
  }
}
