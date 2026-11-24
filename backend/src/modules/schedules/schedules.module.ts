import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Global()
@Module({
  providers: [AvailabilityService, SchedulesService],
  controllers: [SchedulesController],
  exports: [AvailabilityService],
})
export class SchedulesModule {}
