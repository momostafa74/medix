import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class PrescriptionItemDto {
  @ApiPropertyOptional({ description: 'Catalog medicine (preferred). Free-text name otherwise.' }) @IsOptional() @IsUUID() medicineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(150) medicineName?: string;
  @ApiProperty({ example: 'قرص واحد' }) @IsString() @MinLength(1) @MaxLength(80) dose!: string;
  @ApiProperty({ example: 'كل 12 ساعة' }) @IsString() @MinLength(1) @MaxLength(80) frequency!: string;
  @ApiProperty({ example: '7 أيام' }) @IsString() @MinLength(1) @MaxLength(80) duration!: string;
  @ApiPropertyOptional({ description: 'Packs to dispense' }) @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) instructions?: string;
}

export class CreatePrescriptionDto {
  @ApiProperty() @IsUUID() patientId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() appointmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @IsInt() @Min(1) @Max(365) validDays?: number;
  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}

export class RevokeDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class RxLookupDto {
  @ApiProperty({ description: 'QR verification code, or the printed number (RX-…) together with the patient phone' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ description: "Patient's phone — required when looking up by the printed number" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class DispenseDto extends RxLookupDto {
  @ApiPropertyOptional({ description: 'Pharmacy order that fulfilled it' }) @IsOptional() @IsUUID() orderId?: string;
}

export class PrescriptionsQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
}
