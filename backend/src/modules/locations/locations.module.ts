import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Area, City, Country, Governorate } from '../../database/entities';
import { LocationsController } from './locations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Country, Governorate, City, Area])],
  controllers: [LocationsController],
})
export class LocationsModule {}
