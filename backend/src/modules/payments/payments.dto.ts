import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CommissionScope, DiscountType, PaymentMethod, PaymentStatus, ProviderType } from '../../database/entities';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';
import { SERVICE_TYPES } from './payments-logic';

export const PAYABLE_ENTITIES = ['APPOINTMENT', 'LAB_ORDER', 'RADIOLOGY_ORDER', 'PHARMACY_ORDER'] as const;

export class CheckoutDto {
  @ApiProperty({ enum: PAYABLE_ENTITIES }) @IsIn(PAYABLE_ENTITIES as unknown as string[]) entityType!: (typeof PAYABLE_ENTITIES)[number];
  @ApiProperty() @IsUUID() entityId!: string;
}

export class SandboxCompleteDto {
  @ApiProperty() @IsString() @MaxLength(128) sig!: string;
  @ApiProperty({ example: '4242424242424242' }) @IsString() @Matches(/^\d{12,19}$/, { message: 'رقم البطاقة غير صحيح' }) card!: string;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'Omit for a full refund' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class PaymentsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['PLATFORM', 'PROVIDER'] }) @IsOptional() @IsIn(['PLATFORM', 'PROVIDER']) collectedBy?: 'PLATFORM' | 'PROVIDER';
}

export class CouponPreviewDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @ApiProperty({ enum: SERVICE_TYPES }) @IsIn(SERVICE_TYPES as unknown as string[]) serviceType!: (typeof SERVICE_TYPES)[number];
  @ApiProperty() @IsUUID() providerId!: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) amount!: number;
}

export class CouponDto {
  @ApiProperty({ example: 'WELCOME20' }) @IsString() @Matches(/^[A-Za-z0-9_-]{3,30}$/, { message: 'الكود حروف إنجليزية وأرقام فقط (3–30)' }) code!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) description?: string;
  @ApiProperty({ enum: DiscountType }) @IsEnum(DiscountType) type!: DiscountType;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000) value!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) maxDiscount?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minOrder?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) perUserLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string | null;
  @ApiPropertyOptional({ enum: SERVICE_TYPES }) @IsOptional() @IsIn(SERVICE_TYPES as unknown as string[]) serviceType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CouponsQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) serviceType?: string;
}

export class CommissionRuleDto {
  @ApiProperty({ enum: CommissionScope }) @IsEnum(CommissionScope) scope!: CommissionScope;
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) providerType?: ProviderType | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string | null;
  @ApiProperty({ enum: DiscountType }) @IsEnum(DiscountType) type!: DiscountType;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) value!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SettlementDto {
  @ApiProperty() @IsUUID() providerId!: string;
  @ApiProperty({ enum: ['TO_PROVIDER', 'TO_PLATFORM'] }) @IsIn(['TO_PROVIDER', 'TO_PLATFORM']) direction!: 'TO_PROVIDER' | 'TO_PLATFORM';
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class FinanceQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class BalancesQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProviderType }) @IsOptional() @IsEnum(ProviderType) type?: ProviderType;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() nonZero?: boolean;
}
