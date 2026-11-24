import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Gender } from '../../database/entities';

export class UpdatePatientDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string | null;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) bloodType?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) emergencyContactName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) emergencyContactPhone?: string | null;
}

export class AllergyDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) allergen!: string;
  @ApiPropertyOptional({ enum: ['MILD', 'MODERATE', 'SEVERE'] }) @IsOptional() @IsIn(['MILD', 'MODERATE', 'SEVERE']) severity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reaction?: string;
}

export class ConditionDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isChronic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() diagnosedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class MedicationDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) dosage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) frequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCurrent?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startedAt?: string;
}

export class SurgeryDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() performedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) hospital?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RecordNotesDto {
  @ApiProperty() @IsString() @MaxLength(5000) notes!: string;
}

export const DOC_TYPES = ['REPORT', 'PRESCRIPTION', 'REFERRAL', 'LAB', 'RADIOLOGY', 'OTHER'];
export class AddMedicalDocumentDto {
  @ApiProperty() @IsUUID() fileId!: string;
  @ApiProperty({ enum: DOC_TYPES }) @IsIn(DOC_TYPES) type!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() documentDate?: string;
}

export class GrantAccessDto {
  @ApiProperty() @IsUUID() providerId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}
