import { ApiPropertyOptional } from '@nestjs/swagger';
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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Gender } from '../../database/entities';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';

export class SearchDoctorsQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() specialtyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) specialtySlug?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() governorateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) minRating?: number;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() online?: boolean;
  @ApiPropertyOptional() @IsOptional() @ToBool() @IsBoolean() homeVisit?: boolean;
  @ApiPropertyOptional({ description: 'Has working hours on this date (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  availableOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5) language?: string;
  @ApiPropertyOptional({ enum: ['recommended', 'price_asc', 'price_desc', 'rating', 'experience'] })
  @IsOptional()
  @IsIn(['recommended', 'price_asc', 'price_desc', 'rating', 'experience'])
  sort?: string;
}

export class UpdateDoctorProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) title?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(2000) qualifications?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) licenseNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) licenseAuthority?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(70) experienceYears?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) consultationPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) onlinePrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) homeVisitPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onlineAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() homeVisitAvailable?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsIn(['ar', 'en', 'fr', 'de', 'es', 'it', 'ru', 'tr'], { each: true }) languages?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoConfirm?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(72) cancellationWindowHours?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(180) bookingHorizonDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() primarySpecialtyId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) subSpecialtyIds?: string[];
}
