import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AppointmentStatus, AppointmentType } from '../../database/entities';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class BookAppointmentDto {
  @ApiProperty() @IsUUID() doctorId!: string;
  @ApiProperty({ example: '2026-10-06T08:00:00.000Z', description: 'Exact slot start returned by /doctors/:id/availability' })
  @IsDateString()
  startAt!: string;
  @ApiPropertyOptional({ enum: AppointmentType, default: AppointmentType.CLINIC }) @IsOptional() @IsEnum(AppointmentType) type?: AppointmentType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'Required for HOME visits' }) @IsOptional() @IsString() @MinLength(5) @MaxLength(300) homeAddress?: string;
  @ApiPropertyOptional({ description: 'Staff only: book on behalf of a patient' }) @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional({ description: 'Discount code' }) @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}

export class RescheduleDto {
  @ApiProperty() @IsDateString() startAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class CancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW] })
  @IsIn([AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])
  status!: AppointmentStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class DoctorNotesDto {
  @ApiProperty() @IsString() @MaxLength(5000) doctorNotes!: string;
}

export class ListAppointmentsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['patient', 'provider', 'all'] }) @IsOptional() @IsIn(['patient', 'provider', 'all']) scope?: 'patient' | 'provider' | 'all';
  @ApiPropertyOptional({ enum: AppointmentStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];
  @ApiPropertyOptional({ enum: ['upcoming', 'past', 'today'] }) @IsOptional() @IsIn(['upcoming', 'past', 'today']) when?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
}
