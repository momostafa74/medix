import { Module } from '@nestjs/common';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

@Module({
  providers: [DoctorsService],
  controllers: [DoctorsController],
})
export class DoctorsModule {}
