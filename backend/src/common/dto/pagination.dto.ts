import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortDir?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const paginate = <T>(items: T[], total: number, q: { page: number; pageSize: number }): Paginated<T> => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
  totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
});

export const skipTake = (q: { page: number; pageSize: number }) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

/** Escape LIKE wildcards in user search input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/** Query-string boolean ("true"/"1" → true). `@Type(() => Boolean)` would turn "false" into true. */
export const ToBool = () =>
  Transform(({ value }) => (value === undefined || value === '' ? undefined : value === true || value === 'true' || value === '1'));
