import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ReviewStatus } from '../../database/entities';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ReviewsService } from './reviews.service';

class CreateReviewDto {
  @ApiProperty() @IsUUID() appointmentId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
class ModerateDto {
  @ApiProperty({ enum: ReviewStatus }) @IsEnum(ReviewStatus) status!: ReviewStatus;
}
class AdminReviewsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus }) @IsOptional() @IsEnum(ReviewStatus) status?: ReviewStatus;
}

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private service: ReviewsService) {}

  @ApiBearerAuth()
  @Post('reviews')
  @RequirePermissions(P.REVIEWS_WRITE)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateReviewDto) {
    return this.service.create(u, dto.appointmentId, dto.rating, dto.comment);
  }

  @Public()
  @Get('providers/:id/reviews')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.service.publicList(id, q.page, q.pageSize);
  }

  @ApiBearerAuth()
  @Get('reviews/received')
  @RequirePermissions(P.DASHBOARD_PROVIDER)
  received(@CurrentUser() u: AuthUser, @Query() q: PaginationQueryDto) {
    return this.service.forProvider(u, q.page, q.pageSize);
  }

  @ApiBearerAuth()
  @Get('admin/reviews')
  @RequirePermissions(P.REVIEWS_MODERATE)
  adminList(@Query() q: AdminReviewsQuery) {
    return this.service.adminList(q);
  }

  @ApiBearerAuth()
  @Patch('admin/reviews/:id')
  @RequirePermissions(P.REVIEWS_MODERATE)
  moderate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateDto) {
    return this.service.moderate(u, id, dto.status);
  }
}

@ApiTags('Favorites')
@ApiBearerAuth()
@Controller('favorites')
@RequirePermissions(P.FAVORITES_OWN)
export class FavoritesController {
  constructor(private service: ReviewsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.service.favorites(u);
  }

  @Get('ids')
  ids(@CurrentUser() u: AuthUser) {
    return this.service.favoriteIds(u);
  }

  @Put(':providerId')
  add(@CurrentUser() u: AuthUser, @Param('providerId', ParseUUIDPipe) id: string) {
    return this.service.addFavorite(u, id);
  }

  @Delete(':providerId')
  remove(@CurrentUser() u: AuthUser, @Param('providerId', ParseUUIDPipe) id: string) {
    return this.service.removeFavorite(u, id);
  }
}
