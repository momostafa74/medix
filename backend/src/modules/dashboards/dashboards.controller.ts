import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { DashboardsService } from './dashboards.service';

class RangeQuery {
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
class ExportQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: ['provider', 'all'] }) @IsOptional() @IsIn(['provider', 'all']) scope?: string;
}

@ApiTags('Dashboards & reports')
@ApiBearerAuth()
@Controller()
export class DashboardsController {
  constructor(private service: DashboardsService) {}

  @Get('dashboards/admin')
  @RequirePermissions(P.DASHBOARD_ADMIN)
  admin(@Query() q: RangeQuery) {
    return this.service.admin(this.service.range(q.from, q.to));
  }

  @Get('dashboards/doctor')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  doctor(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) {
    return this.service.doctor(u, this.service.range(q.from, q.to));
  }

  @Get('dashboards/patient')
  @RequirePermissions(P.APPOINTMENTS_READ_OWN)
  patient(@CurrentUser() u: AuthUser) {
    return this.service.patient(u);
  }

  @Get('reports/appointments.csv')
  @RequireAnyPermission(P.DASHBOARD_PROVIDER, P.REPORTS_READ_ANY)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(@CurrentUser() u: AuthUser, @Query() q: ExportQuery, @Res() res: Response) {
    const all = q.scope === 'all' && u.permissions.has(P.REPORTS_READ_ANY);
    const r = this.service.range(q.from, q.to);
    const csv = await this.service.appointmentsCsv(u, r, all);
    res.setHeader('Content-Disposition', `attachment; filename="appointments-${q.from ?? 'last30'}-${q.to ?? 'today'}.csv"`);
    res.send(csv);
  }
}
