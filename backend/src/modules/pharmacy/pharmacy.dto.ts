import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FulfillmentType, PaymentMethod, PharmacyOrderStatus } from '../../database/entities';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';

const Money = () => (target: object, key: string) => {
  Type(() => Number)(target, key);
  IsNumber({ maxDecimalPlaces: 2 })(target, key);
  Min(0)(target, key);
  Max(100000)(target, key);
};

// ─────────────── Medicines catalog ───────────────

export class MedicineSearchQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['MEDICINE', 'PRODUCT'] }) @IsOptional() @IsIn(['MEDICINE', 'PRODUCT']) kind?: 'MEDICINE' | 'PRODUCT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() requiresPrescription?: boolean;
  @ApiPropertyOptional({ description: 'Only medicines offered (in stock) by at least one pharmacy' }) @IsOptional() @ToBool() @IsBoolean() available?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
}

export class MedicineDto {
  @ApiProperty({ example: 'Panadol Extra' }) @IsString() @MinLength(2) @MaxLength(120) nameEn!: string;
  @ApiPropertyOptional({ example: 'بنادول إكسترا' }) @IsOptional() @IsString() @MaxLength(120) nameAr?: string | null;
  @ApiPropertyOptional({ example: 'Paracetamol + Caffeine' }) @IsOptional() @IsString() @MaxLength(160) genericName?: string | null;
  @ApiPropertyOptional({ example: 'Tablets' }) @IsOptional() @IsString() @MaxLength(40) form?: string | null;
  @ApiPropertyOptional({ example: '500mg' }) @IsOptional() @IsString() @MaxLength(40) strength?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) manufacturer?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresPrescription?: boolean;
  @ApiPropertyOptional({ enum: ['MEDICINE', 'PRODUCT'] }) @IsOptional() @IsIn(['MEDICINE', 'PRODUCT']) kind?: 'MEDICINE' | 'PRODUCT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) barcode?: string | null;
}

export class AdminMedicineDto extends MedicineDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateMedicineDto extends PartialType(AdminMedicineDto) {}

export class AdminMedicinesQuery extends MedicineSearchQuery {
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Added by pharmacies (needs review)' }) @IsOptional() @ToBool() @IsBoolean() pharmacyAdded?: boolean;
}

// ─────────────── Pharmacy settings & inventory ───────────────

export class UpdatePharmacySettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() deliveryAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @Money() deliveryFee?: number | null;
  @ApiPropertyOptional() @IsOptional() @Money() freeDeliveryOver?: number | null;
  @ApiPropertyOptional() @IsOptional() @Money() minOrderForDelivery?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(10) @Max(1440) estimatedDeliveryMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) deliveryAreasNote?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is24Hours?: boolean;
}

export class InventoryQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['MEDICINE', 'PRODUCT'] }) @IsOptional() @IsIn(['MEDICINE', 'PRODUCT']) kind?: 'MEDICINE' | 'PRODUCT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ enum: ['in', 'out', 'low'] }) @IsOptional() @IsIn(['in', 'out', 'low']) stock?: 'in' | 'out' | 'low';
}

export class InventoryItemDto {
  @ApiProperty() @IsUUID() medicineId!: string;
  @ApiProperty() @Money() price!: number;
  @ApiPropertyOptional({ description: 'Units on hand; null = not tracked' }) @IsOptional() @IsInt() @Min(0) @Max(100000) quantity?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() inStock?: boolean;
}

export class UpdateInventoryDto {
  @ApiPropertyOptional() @IsOptional() @Money() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) quantity?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inStock?: boolean;
}

export class NewMedicineInventoryDto extends MedicineDto {
  @ApiProperty() @Money() price!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) quantity?: number | null;
}

export class PublicCatalogQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['MEDICINE', 'PRODUCT'] }) @IsOptional() @IsIn(['MEDICINE', 'PRODUCT']) kind?: 'MEDICINE' | 'PRODUCT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
}

// ─────────────── Orders ───────────────

export class CartItemDto {
  @ApiProperty() @IsUUID() medicineId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(50) quantity!: number;
}

export class PlaceOrderDto {
  @ApiProperty({ description: 'Pharmacy provider id, pharmacy id or slug' }) @IsString() @MaxLength(80) pharmacy!: string;
  @ApiProperty({ type: [CartItemDto], description: 'May be empty when a prescription is attached — the pharmacy prices it (quote).' })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];
  @ApiPropertyOptional({ description: 'E-prescription to fill' }) @IsOptional() @IsUUID() prescriptionId?: string;
  @ApiPropertyOptional({ description: 'Uploaded paper prescription (files purpose PRESCRIPTION_UPLOAD)' }) @IsOptional() @IsUUID() prescriptionFileId?: string;
  @ApiProperty({ enum: FulfillmentType }) @IsEnum(FulfillmentType) fulfillment!: FulfillmentType;
  @ApiPropertyOptional({ description: 'Pickup branch' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(8) @MaxLength(300) deliveryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'Discount code (not for prescription quotes)' }) @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}

export class ConfirmOrderDto {
  @ApiPropertyOptional({ type: [CartItemDto], description: 'Final lines (pricing a quote, or substitutions). Omit to keep the patient’s cart.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items?: CartItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) pharmacistNote?: string;
}

export class PharmacyStatusDto {
  @ApiProperty({ enum: PharmacyOrderStatus }) @IsEnum(PharmacyOrderStatus) status!: PharmacyOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) driverPhone?: string;
  @ApiPropertyOptional({ enum: PaymentMethod, description: 'On DELIVERED: how the patient paid' }) @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
}

export class PharmacyCancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class PharmacyOrdersQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated statuses' }) @IsOptional() @IsString() @MaxLength(120) status?: string;
  @ApiPropertyOptional({ enum: FulfillmentType }) @IsOptional() @IsEnum(FulfillmentType) fulfillment?: FulfillmentType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() pharmacyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}

export class PharmacyDashboardQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}
