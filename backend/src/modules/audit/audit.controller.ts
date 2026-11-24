import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsIP, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { RequirePermissions } from '../../common/decorators';
import { likeEscape, paginate, PaginationQueryDto, skipTake } from '../../common/dto/pagination.dto';
import { P } from '../../common/permissions';
import { describeDevice } from '../../common/utils/security';
import { AUDIT_CATEGORIES, auditCategoryOf } from './audit-categories';

const CATEGORY_KEYS = Object.keys(AUDIT_CATEGORIES);

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional({ enum: CATEGORY_KEYS }) @IsOptional() @IsIn(CATEGORY_KEYS) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ description: 'Name / phone / email of the actor' }) @IsOptional() @IsString() @MaxLength(80) user?: string;
  @ApiPropertyOptional() @IsOptional() @IsIP() ip?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

const EXPORT_LIMIT = 50_000;
const TZ = 'Africa/Cairo';
const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote everything. Plain numbers like +2010… stay as they are.
  const safe = /^[=@\t\r]|^[+-](?![\d\s.]+$)/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

@ApiTags('Audit logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private ds: DataSource) {}

  private where(q: AuditQueryDto) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (q.action) add('a.action = ?', q.action);
    if (q.category) add('a.action ~ ?', AUDIT_CATEGORIES[q.category as keyof typeof AUDIT_CATEGORIES].pattern);
    if (q.entity) add('a.entity = ?', q.entity);
    if (q.entityId) add('a.entity_id = ?', q.entityId);
    if (q.userId) add('a.user_id = ?', q.userId);
    if (q.user?.trim()) add('(u.full_name ILIKE ? OR u.phone ILIKE ? OR u.email ILIKE ?)', `%${likeEscape(q.user.trim())}%`);
    if (q.ip) add('a.ip = ?', q.ip);
    if (q.from) add('a.created_at >= ?', DateTime.fromISO(q.from, { zone: TZ }).startOf('day').toJSDate());
    if (q.to) add('a.created_at <= ?', DateTime.fromISO(q.to, { zone: TZ }).endOf('day').toJSDate());
    if (q.search?.trim()) add('(a.action ILIKE ? OR a.entity ILIKE ? OR a.entity_id ILIKE ?)', `%${likeEscape(q.search.trim())}%`);
    return { cond: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  private shape(r: any) {
    return {
      id: r.id,
      action: r.action,
      category: auditCategoryOf(r.action),
      entity: r.entity,
      entityId: r.entity_id,
      ip: r.ip,
      device: describeDevice(r.user_agent),
      userAgent: r.user_agent,
      oldValue: r.old_value,
      newValue: r.new_value,
      createdAt: r.created_at,
      user: r.user_id ? { id: r.user_id, fullName: r.full_name, phone: r.phone, email: r.email } : null,
    };
  }

  private readonly select = `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.user_agent, a.old_value, a.new_value, a.created_at, a.user_id, u.full_name, u.phone, u.email
                               FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id`;

  @Get()
  @RequirePermissions(P.AUDIT_READ)
  async list(@Query() q: AuditQueryDto) {
    const { cond, params } = this.where(q);
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(`${this.select} ${cond} ORDER BY a.created_at DESC LIMIT ${take} OFFSET ${skip}`, params);
    return paginate(rows.map((r: any) => this.shape(r)), total, q);
  }

  @Get('actions')
  @RequirePermissions(P.AUDIT_READ)
  async actions() {
    const rows: { action: string }[] = await this.ds.query(`SELECT DISTINCT action FROM audit_logs ORDER BY action`);
    return rows.map((r) => r.action);
  }

  @Get('categories')
  @RequirePermissions(P.AUDIT_READ)
  categories() {
    return Object.entries(AUDIT_CATEGORIES).map(([key, v]) => ({ key, label: v.label }));
  }

  @Get('export.csv')
  @RequirePermissions(P.AUDIT_READ)
  @ApiOperation({ summary: `Same filters as the list, up to ${EXPORT_LIMIT} rows, UTF-8 with BOM (opens in Excel)` })
  async export(@Query() q: AuditQueryDto, @Res() res: Response) {
    const { cond, params } = this.where(q);
    const rows = await this.ds.query(`${this.select} ${cond} ORDER BY a.created_at DESC LIMIT ${EXPORT_LIMIT}`, params);
    const header = ['time', 'action', 'category', 'user', 'phone', 'entity', 'entity_id', 'ip', 'device', 'old_value', 'new_value'];
    const lines = rows.map((r: any) =>
      [
        DateTime.fromJSDate(new Date(r.created_at)).setZone(TZ).toFormat('yyyy-LL-dd HH:mm:ss'),
        r.action,
        auditCategoryOf(r.action),
        r.full_name,
        r.phone,
        r.entity,
        r.entity_id,
        r.ip,
        describeDevice(r.user_agent),
        r.old_value,
        r.new_value,
      ]
        .map(csvCell)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${DateTime.now().setZone(TZ).toFormat('yyyyLLdd-HHmm')}.csv"`);
    res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
  }

  @Get('entity/:entity/:entityId')
  @RequirePermissions(P.AUDIT_READ)
  @ApiOperation({ summary: 'Full history of one record' })
  async history(@Param('entity') entity: string, @Param('entityId') entityId: string) {
    const rows = await this.ds.query(`${this.select} WHERE a.entity = $1 AND a.entity_id = $2 ORDER BY a.created_at DESC LIMIT 500`, [entity.slice(0, 60), entityId.slice(0, 80)]);
    return rows.map((r: any) => this.shape(r));
  }

  @Get(':id')
  @RequirePermissions(P.AUDIT_READ)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const [r] = await this.ds.query(`${this.select} WHERE a.id = $1`, [id]);
    if (!r) throw new NotFoundException('السجل غير موجود');
    return this.shape(r);
  }
}
