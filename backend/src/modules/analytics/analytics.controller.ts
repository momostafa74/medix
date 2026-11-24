import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ProviderType } from '../../database/entities';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsService, Compare } from './analytics.service';
import { Granularity } from './analytics-logic';

class RangeQuery {
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @ApiPropertyOptional({ enum: ['previous', 'year', 'none'], default: 'previous' }) @IsOptional() @IsIn(['previous', 'year', 'none']) compare?: Compare;
}
class SeriesQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], description: 'Default: by range length' }) @IsOptional() @IsIn(['day', 'week', 'month']) granularity?: Granularity;
}
class CohortQuery {
  @ApiPropertyOptional({ default: 6 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(12) months?: number;
}
class LeaderboardQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) type?: ProviderType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional({ enum: ['bookings', 'completed', 'gmv', 'commission', 'completionRate', 'cancellationRate', 'rating', 'patients'] })
  @IsOptional()
  @IsIn(['bookings', 'completed', 'gmv', 'commission', 'completionRate', 'cancellationRate', 'rating', 'patients'])
  sort?: string;
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

const send = (res: Response, { buffer, fileName }: { buffer: Buffer; fileName: string }, type: string) => {
  res.set({ 'Content-Type': type, 'Content-Length': String(buffer.length), 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
  res.end(buffer);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Platform-wide analytics (finance / management). */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private service: AnalyticsService,
    private exporter: AnalyticsExportService,
  ) {}

  @Get('overview')
  @RequirePermissions(P.ANALYTICS_READ)
  @ApiOperation({ summary: 'KPIs for the period with the previous period (or same period last year) and % change' })
  overview(@Query() q: RangeQuery) {
    return this.service.overview(this.service.range(q.from, q.to), q.compare ?? 'previous', null);
  }

  @Get('timeseries')
  @RequirePermissions(P.ANALYTICS_READ)
  timeseries(@Query() q: SeriesQuery) {
    return this.service.timeseries(this.service.range(q.from, q.to), q.granularity, null, q.compare ?? 'none');
  }

  @Get('breakdowns')
  @RequirePermissions(P.ANALYTICS_READ)
  @ApiOperation({ summary: 'By service, channel, specialty, governorate, payment method; busiest hours; patient mix' })
  breakdowns(@Query() q: RangeQuery) {
    return this.service.breakdowns(this.service.range(q.from, q.to), null);
  }

  @Get('funnel')
  @RequirePermissions(P.ANALYTICS_READ)
  funnel(@Query() q: RangeQuery) {
    return this.service.funnel(this.service.range(q.from, q.to), null);
  }

  @Get('cohorts')
  @RequirePermissions(P.ANALYTICS_READ)
  @ApiOperation({ summary: 'Monthly patient retention cohorts' })
  cohorts(@Query() q: CohortQuery) {
    return this.service.cohorts(null, q.months ?? 6);
  }

  @Get('providers')
  @RequirePermissions(P.ANALYTICS_READ)
  @ApiOperation({ summary: 'Provider leaderboard: bookings, completion, cancellations, patients, payments, commission, rating' })
  providers(@Query() q: LeaderboardQuery) {
    return this.service.leaderboard(this.service.range(q.from, q.to), q);
  }

  @Get('export.xlsx')
  @RequirePermissions(P.ANALYTICS_READ)
  async xlsx(@Query() q: RangeQuery, @Res() res: Response) {
    send(res, await this.exporter.xlsx(this.service.range(q.from, q.to), q.compare ?? 'previous', null), XLSX);
  }

  @Get('report.pdf')
  @RequirePermissions(P.ANALYTICS_READ)
  async pdf(@Query() q: RangeQuery, @Res() res: Response) {
    send(res, await this.exporter.pdfReport(this.service.range(q.from, q.to), q.compare ?? 'previous', null, 'تقرير الأداء'), 'application/pdf');
  }
}

/** The same analytics restricted to the caller's own provider (doctor, lab, radiology center, pharmacy). */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics/provider')
export class ProviderAnalyticsController {
  constructor(
    private service: AnalyticsService,
    private exporter: AnalyticsExportService,
  ) {}

  @Get('overview')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  overview(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) {
    return this.service.overview(this.service.range(q.from, q.to), q.compare ?? 'previous', this.service.providerScope(u));
  }

  @Get('timeseries')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  timeseries(@CurrentUser() u: AuthUser, @Query() q: SeriesQuery) {
    return this.service.timeseries(this.service.range(q.from, q.to), q.granularity, this.service.providerScope(u), q.compare ?? 'none');
  }

  @Get('breakdowns')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  breakdowns(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) {
    return this.service.breakdowns(this.service.range(q.from, q.to), this.service.providerScope(u));
  }

  @Get('funnel')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  funnel(@CurrentUser() u: AuthUser, @Query() q: RangeQuery) {
    return this.service.funnel(this.service.range(q.from, q.to), this.service.providerScope(u));
  }

  @Get('cohorts')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  cohorts(@CurrentUser() u: AuthUser, @Query() q: CohortQuery) {
    return this.service.cohorts(this.service.providerScope(u), q.months ?? 6);
  }

  @Get('export.xlsx')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  async xlsx(@CurrentUser() u: AuthUser, @Query() q: RangeQuery, @Res() res: Response) {
    send(res, await this.exporter.xlsx(this.service.range(q.from, q.to), q.compare ?? 'previous', this.service.providerScope(u)), XLSX);
  }

  @Get('report.pdf')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  async pdf(@CurrentUser() u: AuthUser, @Query() q: RangeQuery, @Res() res: Response) {
    send(res, await this.exporter.pdfReport(this.service.range(q.from, q.to), q.compare ?? 'previous', this.service.providerScope(u), 'تقرير أداء مقدم الخدمة'), 'application/pdf');
  }
}
