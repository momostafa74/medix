import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto, ToBool } from '../../common/dto/pagination.dto';
import { IsBoolean } from 'class-validator';

export class OpenRoomDto {
  @ApiProperty({ enum: ['PATIENT_PROVIDER', 'ADMIN_PROVIDER', 'SUPPORT'] })
  @IsIn(['PATIENT_PROVIDER', 'ADMIN_PROVIDER', 'SUPPORT'])
  type!: 'PATIENT_PROVIDER' | 'ADMIN_PROVIDER' | 'SUPPORT';

  @ApiPropertyOptional({ description: 'Required for PATIENT_PROVIDER and ADMIN_PROVIDER' })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ description: 'Provider side only: open a PATIENT_PROVIDER room with a patient you have a care relationship with' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Optional first message' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}

export class SendMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileId?: string;
  @ApiPropertyOptional({ description: 'Client-generated id echoed back for optimistic UI' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;
}

export class MessagesQuery {
  @ApiPropertyOptional({ description: 'Return messages older than this ISO timestamp' }) @IsOptional() @IsDateString() before?: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class RoomsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PATIENT_PROVIDER', 'ADMIN_PROVIDER', 'SUPPORT'] })
  @IsOptional()
  @IsIn(['PATIENT_PROVIDER', 'ADMIN_PROVIDER', 'SUPPORT'])
  type?: string;

  @ApiPropertyOptional({ description: 'Platform team: only reported conversations' })
  @IsOptional()
  @ToBool()
  @IsBoolean()
  reported?: boolean;
}

export class ReportDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
