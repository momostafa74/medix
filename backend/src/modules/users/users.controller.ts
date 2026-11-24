import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowUnsubscribed, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { UsersService } from './users.service';
import { CreateStaffUserDto, ListUsersDto, SetRolePermissionsDto, SetRolesDto, UpdateMeDto, UpdateUserStatusDto } from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  @Patch('me')
  @AllowUnsubscribed()
  updateMe(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.service.updateMe(u.id, dto);
  }

  @Get()
  @RequirePermissions(P.USERS_READ)
  list(@Query() q: ListUsersDto) {
    return this.service.list(q);
  }

  @Post('staff')
  @RequirePermissions(P.USERS_MANAGE)
  createStaff(@CurrentUser() u: AuthUser, @Body() dto: CreateStaffUserDto) {
    return this.service.createStaff(u, dto);
  }

  @Get(':id')
  @RequirePermissions(P.USERS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Patch(':id/status')
  @RequirePermissions(P.USERS_MANAGE)
  setStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.service.setStatus(u, id, dto.status, dto.reason);
  }

  @Put(':id/roles')
  @RequirePermissions(P.ROLES_MANAGE)
  setRoles(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto) {
    return this.service.setRoles(u, id, dto.roles);
  }
}

@ApiTags('Roles & permissions')
@ApiBearerAuth()
@Controller()
export class RbacController {
  constructor(private service: UsersService) {}

  @Get('roles')
  @RequirePermissions(P.USERS_READ)
  roles() {
    return this.service.listRoles();
  }

  @Get('permissions')
  @RequirePermissions(P.USERS_READ)
  permissions() {
    return this.service.listPermissions();
  }

  @Put('roles/:code/permissions')
  @RequirePermissions(P.ROLES_MANAGE)
  setPerms(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: SetRolePermissionsDto) {
    return this.service.setRolePermissions(u, code, dto.permissions);
  }
}
