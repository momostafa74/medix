import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { FileEntity, Specialty } from '../../database/entities';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { CachePublic, InvalidatesCache } from '../../common/cache/http-cache.interceptor';

class CreateSpecialtyDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) nameAr!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) nameEn!: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]{2,60}$/, { message: 'المعرف يجب أن يكون حروف إنجليزية صغيرة وأرقام وشرطات' }) slug!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() imageFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateSpecialtyDto extends PartialType(CreateSpecialtyDto) {}

class ListQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() includeInactive?: boolean;
}

@ApiTags('Specialties')
@Controller('specialties')
export class SpecialtiesController {
  constructor(
    @InjectRepository(Specialty) private repo: Repository<Specialty>,
    @InjectRepository(FileEntity) private files: Repository<FileEntity>,
    private audit: AuditService,
  ) {}

  /** Public list with the number of approved, active doctors per specialty. */
  @Public()
  @CachePublic(60, 'specialties')
  @Get()
  async list(@Query() q: ListQuery, @CurrentUser() u?: AuthUser) {
    const showAll = q.includeInactive && u?.permissions.has(P.SPECIALTIES_MANAGE);
    // doctor count = approved & active doctors only
    const rows = await this.repo
      .createQueryBuilder('s')
      .select('s.*')
      .addSelect(
        `(SELECT count(*) FROM doctor_specialties ds
            JOIN doctors d ON d.id = ds.doctor_id
            JOIN providers p ON p.id = d.provider_id
           WHERE ds.specialty_id = s.id AND p.verification_status = 'APPROVED' AND p.is_active AND p.subscription_active)::int`,
        'doctor_count',
      )
      .where(showAll ? '1=1' : 's.is_active = true')
      .orderBy('s.sort_order', 'ASC')
      .addOrderBy('s.name_ar', 'ASC')
      .getRawMany();
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      slug: r.slug,
      description: r.description,
      imageFileId: r.image_file_id,
      icon: r.icon,
      isActive: r.is_active,
      sortOrder: r.sort_order,
      doctorCount: r.doctor_count,
    }));
  }

  @Public()
  @CachePublic(60, 'specialties')
  @Get(':idOrSlug')
  async get(@Param('idOrSlug') key: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const s = await this.repo.findOne({ where: isUuid ? { id: key } : { slug: key }, relations: { children: true } });
    if (!s || !s.isActive) throw new NotFoundException('التخصص غير موجود');
    return s;
  }

  private async checkImage(fileId?: string | null) {
    if (!fileId) return;
    const f = await this.files.findOneBy({ id: fileId, purpose: 'SPECIALTY_IMAGE' });
    if (!f) throw new BadRequestException('الصورة غير صالحة');
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions(P.SPECIALTIES_MANAGE)
  @InvalidatesCache('specialties')
  async create(@Body() dto: CreateSpecialtyDto, @CurrentUser() u: AuthUser) {
    await this.checkImage(dto.imageFileId);
    const saved = await this.repo.save(this.repo.create(dto));
    await this.audit.log({ userId: u.id, action: 'SPECIALTY_CREATED', entity: 'specialties', entityId: saved.id, newValue: dto });
    return saved;
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions(P.SPECIALTIES_MANAGE)
  @InvalidatesCache('specialties')
  async update(@Param('id') id: string, @Body() dto: UpdateSpecialtyDto, @CurrentUser() u: AuthUser) {
    const old = await this.repo.findOneBy({ id });
    if (!old) throw new NotFoundException('التخصص غير موجود');
    if (dto.parentId === id) throw new BadRequestException('لا يمكن أن يكون التخصص فرعياً من نفسه');
    await this.checkImage(dto.imageFileId);
    await this.repo.update(id, dto);
    await this.audit.log({ userId: u.id, action: 'SPECIALTY_UPDATED', entity: 'specialties', entityId: id, oldValue: old, newValue: dto });
    return this.repo.findOneBy({ id });
  }
}
