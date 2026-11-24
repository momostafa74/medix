import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ProviderType } from '../../database/entities';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export const PROVIDER_PAY_METHODS = ['ONLINE', 'INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER'] as const;
export const ADMIN_PAY_METHODS = ['CASH', 'INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER'] as const;

export class SubscribeDto {
  @ApiProperty() @IsUUID() planId!: string;
  @ApiPropertyOptional({ default: 1, description: 'Periods (months) to buy' }) @IsOptional() @IsInt() @Min(1) @Max(12) periods?: number;
  @ApiProperty({ enum: PROVIDER_PAY_METHODS }) @IsIn(PROVIDER_PAY_METHODS as unknown as string[]) method!: (typeof PROVIDER_PAY_METHODS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  @ApiPropertyOptional({ description: 'Transfer receipt (files purpose PAYMENT_PROOF) — required for manual methods' }) @IsOptional() @IsUUID() proofFileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) transferReference?: string;
}

export class PlanDto {
  @ApiProperty({ example: 'DOCTOR_MONTHLY' }) @IsString() @Matches(/^[A-Z0-9_]{3,40}$/, { message: 'الكود حروف إنجليزية كبيرة وأرقام و _ فقط' }) code!: string;
  @ApiProperty({ enum: ProviderType }) @IsEnum(ProviderType) providerType!: ProviderType;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) nameAr!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) price!: number;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @IsInt() @Min(1) @Max(366) durationDays?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(120, { each: true }) features?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) sortOrder?: number;
}

export class ReviewInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ManualSubscriptionDto {
  @ApiProperty() @IsUUID() planId!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(12) periods?: number;
  @ApiProperty({ enum: ADMIN_PAY_METHODS }) @IsIn(ADMIN_PAY_METHODS as unknown as string[]) method!: (typeof ADMIN_PAY_METHODS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ExtendDto {
  @ApiProperty() @IsInt() @Min(1) @Max(365) days!: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) note!: string;
}

export class SubscriptionsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED'] }) @IsOptional() @IsIn(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED']) status?: string;
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) type?: ProviderType;
  @ApiPropertyOptional({ description: 'Ends within N days' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) expiringDays?: number;
}

export class InvoicesQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
}
