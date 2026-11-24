import { Module } from '@nestjs/common';
import { FavoritesController, ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  providers: [ReviewsService],
  controllers: [ReviewsController, FavoritesController],
})
export class ReviewsModule {}
