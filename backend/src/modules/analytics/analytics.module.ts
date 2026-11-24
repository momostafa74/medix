import { Module } from '@nestjs/common';
import { AnalyticsController, ProviderAnalyticsController } from './analytics.controller';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsService } from './analytics.service';

@Module({
  providers: [AnalyticsService, AnalyticsExportService],
  controllers: [ProviderAnalyticsController, AnalyticsController],
})
export class AnalyticsModule {}
