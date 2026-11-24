import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
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
import { Gender } from '../../database/entities';

export const PASSWORD_RULE = /^(?=.*[A-Za-z؀-ۿ])(?=.*\d).{8,72}$/;
const PASSWORD_MSG = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام';

/** Patients sign up with their phone number and a password only — name and the rest are optional. */
export const PATIENT_PASSWORD_MIN = 6;
export class RegisterPatientDto {
  @ApiProperty({ example: '01012345678' }) @IsString() @MaxLength(20) phone!: string;
  @ApiProperty({ minLength: PATIENT_PASSWORD_MIN }) @IsString() @MinLength(PATIENT_PASSWORD_MIN, { message: `كلمة المرور ${PATIENT_PASSWORD_MIN} أحرف أو أرقام على الأقل` }) @MaxLength(72) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(100) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(120) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
}

export class ClinicDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) address!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
}

export class RegisterDoctorDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
  @ApiProperty() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(120) email!: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password!: string;
  @ApiProperty() @IsUUID() specialtyId!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) subSpecialtyIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) title?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) qualifications!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(50) licenseNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) licenseAuthority?: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(70) experienceYears!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) consultationPrice!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) whatsappNumber?: string;
  @ApiPropertyOptional({ type: ClinicDto }) @IsOptional() @ValidateNested() @Type(() => ClinicDto) clinic?: ClinicDto;
}

export const SELF_REGISTER_PROVIDER_TYPES = ['LABORATORY', 'RADIOLOGY', 'PHARMACY'] as const;

/** Labs, radiology centers and pharmacies sign up themselves; the profile stays hidden until admin approval. */
export class RegisterProviderDto {
  @ApiProperty({ enum: SELF_REGISTER_PROVIDER_TYPES }) @IsIn(SELF_REGISTER_PROVIDER_TYPES as unknown as string[]) type!: (typeof SELF_REGISTER_PROVIDER_TYPES)[number];
  @ApiProperty({ description: 'Account manager name' }) @IsString() @MinLength(3) @MaxLength(100) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
  @ApiProperty() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(120) email!: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) nameAr!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) whatsappNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) licenseNumber?: string;
  @ApiPropertyOptional({ description: 'Laboratories: offers home sample collection' }) @IsOptional() @IsBoolean() homeService?: boolean;
  @ApiProperty({ type: ClinicDto }) @ValidateNested() @Type(() => ClinicDto) branch!: ClinicDto;
}

export class LoginDto {
  @ApiProperty({ description: 'Phone number or email' }) @IsString() @IsNotEmpty() @MaxLength(120) identifier!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(72) password!: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Only for non-browser clients; browsers use the httpOnly cookie' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(72) currentPassword!: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) newPassword!: string;
}

export class RequestVerificationDto {
  @ApiProperty({ enum: ['EMAIL', 'PHONE'] }) @IsIn(['EMAIL', 'PHONE']) channel!: 'EMAIL' | 'PHONE';
}

export class ConfirmVerificationDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({ description: 'challengeToken returned by /auth/login' }) @IsString() @MaxLength(1000) challengeToken!: string;
  @ApiProperty({ description: '6-digit authenticator code or a backup code (XXXX-XXXX)' }) @IsString() @MinLength(6) @MaxLength(20) code!: string;
}

export class TwoFactorCodeDto {
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(20) code!: string;
}

export class TwoFactorDisableDto extends TwoFactorCodeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
