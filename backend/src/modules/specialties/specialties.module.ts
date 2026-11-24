import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity, Specialty } from '../../database/entities';
import { SpecialtiesController } from './specialties.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Specialty, FileEntity])],
  controllers: [SpecialtiesController],
})
export class SpecialtiesModule {}
