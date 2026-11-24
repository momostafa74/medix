import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from '../../database/entities';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageService } from './storage';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity])],
  providers: [FilesService, StorageService],
  controllers: [FilesController],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
