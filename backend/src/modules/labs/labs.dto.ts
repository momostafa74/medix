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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Gender, LabOrderStatus, PaymentMethod, ResultFlag } from '../../database/entities';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class HoursBlockDto {
  @ApiProperty({ description: '0 = Sunday … 6 = Saturday' }) @IsInt() @Min(0) @Max(6) day!: number;
  @ApiProperty({ description: 'Minutes from midnight' }) @IsInt() @Min(0) @Max(1439) open!: number;
  @ApiProperty({ description: 'Minutes from midnight' }) @IsInt() @Min(1) @Max(1440) close!: number;
}

export class UpdateLabSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() homeCollection?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000) homeCollectionFee?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) accreditation?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(240) slotMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) slotCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) homeSlotCapacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(90) bookingHorizonDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireSeparateApprover?: boolean;
  @ApiPropertyOptional({ type: [HoursBlockDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => HoursBlockDto)
  homeCollectionHours?: HoursBlockDto[] | null;
}

export class BranchHoursDto {
  @ApiProperty({ type: [HoursBlockDto] })
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => HoursBlockDto)
  openingHours!: HoursBlockDto[];
}

export class CategoryDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
}

export class RangeDto {
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(130) ageMinYears?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(130) ageMaxYears?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() low?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() high?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() criticalLow?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() criticalHigh?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) textRange?: string | null;
}

export class ParameterDto {
  @ApiPropertyOptional({ description: 'Existing parameter id (omit to create)' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) unit?: string | null;
  @ApiPropertyOptional({ enum: ['NUMERIC', 'TEXT'] }) @IsOptional() @IsIn(['NUMERIC', 'TEXT']) resultType?: 'NUMERIC' | 'TEXT';
  @ApiPropertyOptional({ type: [RangeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => RangeDto)
  ranges?: RangeDto[];
}

export class TestDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_.\-]{1,20}$/, { message: 'كود التحليل: حروف إنجليزية وأرقام فقط (حتى 20 حرف)' }) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) sampleType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) preparationInstructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2000) turnaroundHours?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [ParameterDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ParameterDto)
  parameters!: ParameterDto[];
}

export class PackageDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) price!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(60) @IsUUID('all', { each: true }) testIds!: string[];
}

export class PackageVisibilityDto {
  @ApiProperty() @IsBoolean() isVisible!: boolean;
}

export class CatalogTestsQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class SearchTestsQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() governorateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
}

export class SlotsQuery {
  @ApiProperty({ example: '2026-10-10' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty({ enum: ['BRANCH', 'HOME'] }) @IsIn(['BRANCH', 'HOME']) mode!: 'BRANCH' | 'HOME';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class BookLabOrderDto {
  @ApiProperty() @IsUUID() laboratoryId!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) testIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) packageIds?: string[];
  @ApiProperty({ enum: ['BRANCH', 'HOME'] }) @IsIn(['BRANCH', 'HOME']) mode!: 'BRANCH' | 'HOME';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsDateString() scheduledAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(300) homeAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'Discount code' }) @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}

export class LabOrdersQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated statuses' }) @IsOptional() @IsString() @MaxLength(300) status?: string;
  @ApiPropertyOptional({ enum: ['BRANCH', 'HOME'] }) @IsOptional() @IsIn(['BRANCH', 'HOME']) mode?: 'BRANCH' | 'HOME';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() laboratoryId?: string;
  @ApiPropertyOptional({ description: 'Only orders with critical results' }) @IsOptional() @IsIn(['true', 'false']) critical?: string;
}

export class LabStatusDto {
  @ApiProperty({ enum: LabOrderStatus }) @IsEnum(LabOrderStatus) status!: LabOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
}

export class LabPaymentDto {
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
}

export class LabCancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RejectSampleDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class ResultEntryDto {
  @ApiProperty() @IsUUID() parameterId!: string;
  @ApiProperty() @IsString() @MaxLength(120) value!: string;
  @ApiPropertyOptional({ enum: ResultFlag, description: 'Only honoured for TEXT parameters' }) @IsOptional() @IsEnum(ResultFlag) flag?: ResultFlag;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class SaveResultsDto {
  @ApiProperty({ type: [ResultEntryDto] })
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ResultEntryDto)
  items!: ResultEntryDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ReviewNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReturnResultsDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class DashboardRangeQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
