import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PASSWORD_RULE } from '../auth/auth.dto';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProviderType, VerificationStatus } from '../../database/entities';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';

export class UpdateProviderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) whatsappNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_protocol: true }) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() logoFileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() homeServiceAvailable?: boolean;
}

export class BranchDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) address!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() workingHours?: Record<string, unknown> | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBranchDto extends PartialType(BranchDto) {}

export class ServiceDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) price!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateServiceDto extends PartialType(ServiceDto) {}

export const DOCUMENT_TYPES = ['LICENSE', 'NATIONAL_ID', 'SYNDICATE_CARD', 'COMMERCIAL_REGISTER', 'TAX_CARD', 'CERTIFICATE', 'OTHER'];

export class AddDocumentDto {
  @ApiProperty() @IsUUID() fileId!: string;
  @ApiProperty({ enum: DOCUMENT_TYPES }) @IsIn(DOCUMENT_TYPES) type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PublicProvidersQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) type?: ProviderType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() governorateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) minRating?: number;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() homeService?: boolean;
  @ApiPropertyOptional({ enum: ['rating', 'name', 'newest'] }) @IsOptional() @IsIn(['rating', 'name', 'newest']) sort?: string;
}

export class AdminProvidersQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) type?: ProviderType;
  @ApiPropertyOptional({ enum: VerificationStatus }) @IsOptional() @IsEnum(VerificationStatus) status?: VerificationStatus;
}

export class ProviderStatusDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT', 'SUSPEND', 'ACTIVATE'] })
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND', 'ACTIVATE'])
  action!: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'ACTIVATE';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateStaffDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(120) email?: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام' }) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Manager: can edit profile, catalog, team and approve results' }) @IsOptional() @IsBoolean() isAdmin?: boolean;
}

export class UpdateStaffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAdmin?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
