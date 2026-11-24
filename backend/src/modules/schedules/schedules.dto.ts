import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AppointmentType, ScheduleExceptionType } from '../../database/entities';

const HHMM = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export class BreakDto {
  @ApiProperty({ example: '12:00' }) @Matches(HHMM) start!: string;
  @ApiProperty({ example: '12:30' }) @Matches(HHMM) end!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) label?: string;
}

export class ScheduleBlockDto {
  @ApiProperty({ description: '0=Sunday … 6=Saturday' }) @Type(() => Number) @IsInt() @Min(0) @Max(6) dayOfWeek!: number;
  @ApiProperty({ example: '10:00' }) @Matches(HHMM) start!: string;
  @ApiProperty({ example: '14:00' }) @Matches(HHMM) end!: string;
  @ApiProperty({ example: 20 }) @Type(() => Number) @IsInt() @Min(5) @Max(240) slotDuration!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional({ enum: AppointmentType }) @IsOptional() @IsEnum(AppointmentType) appointmentType?: AppointmentType;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [BreakDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BreakDto)
  breaks?: BreakDto[];
}

export class ReplaceScheduleDto {
  @ApiProperty({ type: [ScheduleBlockDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ScheduleBlockDto)
  blocks!: ScheduleBlockDto[];
}

export class ExceptionDto {
  @ApiProperty({ enum: ScheduleExceptionType }) @IsEnum(ScheduleExceptionType) type!: ScheduleExceptionType;
  @ApiProperty({ example: '2026-10-10' }) @IsDateString() startDate!: string;
  @ApiProperty({ example: '2026-10-12' }) @IsDateString() endDate!: string;
  @ApiPropertyOptional({ description: 'CUSTOM_HOURS only' }) @IsOptional() @Matches(HHMM) start?: string;
  @ApiPropertyOptional({ description: 'CUSTOM_HOURS only' }) @IsOptional() @Matches(HHMM) end?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) slotDuration?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class SlotBlockDto {
  @ApiProperty() @IsDateString() startAt!: string;
  @ApiProperty() @IsDateString() endAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class AvailabilityQuery {
  @ApiPropertyOptional({ example: '2026-10-05' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ default: 7, maximum: 31 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) days?: number;
  @ApiPropertyOptional({ enum: AppointmentType }) @IsOptional() @IsEnum(AppointmentType) type?: AppointmentType;
}

export class DoctorScopeQuery {
  @ApiPropertyOptional({ description: 'Admins only: act on behalf of this doctor' }) @IsOptional() @IsUUID() doctorId?: string;
}

