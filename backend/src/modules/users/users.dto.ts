import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { RoleCode, UserStatus } from '../../database/entities';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PASSWORD_RULE } from '../auth/auth.dto';

export class ListUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RoleCode }) @IsOptional() @IsEnum(RoleCode) role?: RoleCode;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.SUSPENDED] })
  @IsIn([UserStatus.ACTIVE, UserStatus.INACTIVE, UserStatus.SUSPENDED])
  status!: UserStatus;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class SetRolesDto {
  @ApiProperty({ enum: RoleCode, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsEnum(RoleCode, { each: true })
  roles!: RoleCode[];
}

/** Admin creates internal staff accounts (ADMIN, SUPPORT, ACCOUNTANT). */
export class CreateStaffUserDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) fullName!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: 'كلمة المرور ضعيفة' }) password!: string;
  @ApiProperty({ enum: [RoleCode.ADMIN, RoleCode.SUPPORT, RoleCode.ACCOUNTANT] })
  @IsIn([RoleCode.ADMIN, RoleCode.SUPPORT, RoleCode.ACCOUNTANT])
  role!: RoleCode;
}

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(100) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['ar', 'en']) locale?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() avatarFileId?: string | null;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions!: string[];
}
