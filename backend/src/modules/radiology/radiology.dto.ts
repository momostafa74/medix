import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, RadiologyOrderStatus } from '../../database/entities';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { MODALITIES } from './radiology-logic';

const MODALITY_CODES = Object.keys(MODALITIES);

export class UpdateCenterSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(120) slotStepMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(120) bookingHorizonDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireSeparateApprover?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) accreditation?: string | null;
}

export class ModalityUnitDto {
  @ApiProperty({ enum: MODALITY_CODES }) @IsIn(MODALITY_CODES) modality!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(50) units!: number;
}

export class BranchModalitiesDto {
  @ApiProperty({ type: [ModalityUnitDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ModalityUnitDto)
  modalities!: ModalityUnitDto[];
}

export class RadiologyServiceDto {
  @ApiProperty({ enum: MODALITY_CODES }) @IsIn(MODALITY_CODES) modality!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(200000) price!: number;
  @ApiProperty() @IsInt() @Min(5) @Max(480) durationMinutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1500) preparationInstructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresReferral?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) reportTemplate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(720) turnaroundHours?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SearchServicesQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MODALITY_CODES }) @IsOptional() @IsIn(MODALITY_CODES) modality?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() governorateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
}

export class RadSlotsQuery {
  @ApiProperty({ example: '2026-10-10' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty() @IsUUID() serviceId!: string;
  @ApiProperty() @IsUUID() branchId!: string;
}

export class BookRadiologyDto {
  @ApiProperty() @IsUUID() serviceId!: string;
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsDateString() scheduledAt!: string;
  @ApiPropertyOptional({ description: 'File uploaded with purpose REFERRAL' }) @IsOptional() @IsUUID() referralFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) clinicalIndication?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) referringDoctor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional({ description: 'Discount code' }) @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}

export class RadOrdersQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated statuses' }) @IsOptional() @IsString() @MaxLength(300) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: MODALITY_CODES }) @IsOptional() @IsIn(MODALITY_CODES) modality?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() centerId?: string;
}

export class RadStatusDto {
  @ApiProperty({ enum: RadiologyOrderStatus }) @IsEnum(RadiologyOrderStatus) status!: RadiologyOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RadPaymentDto {
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
}

export class RadCancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SaveReportDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) technique?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) comparison?: string | null;
  @ApiProperty() @IsString() @MaxLength(20000) findings!: string;
  @ApiProperty() @IsString() @MaxLength(6000) impression!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) recommendations?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() critical?: boolean;
}

export class ReturnReportDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class AttachFileDto {
  @ApiProperty({ description: 'File uploaded with purpose RADIOLOGY_IMAGE' }) @IsUUID() fileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) caption?: string;
}

export class PacsDto {
  @ApiPropertyOptional({ description: 'Link to the study in an external PACS / web viewer' })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { message: 'رابط غير صحيح' })
  @MaxLength(500)
  pacsUrl?: string | null;
}

export class RadDashboardQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class WorklistQuery {
  @ApiPropertyOptional({ example: '2026-10-10' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @ApiPropertyOptional({ enum: MODALITY_CODES }) @IsOptional() @IsIn(MODALITY_CODES) modality?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
