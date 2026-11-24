import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Provider, ProviderBranch, ProviderDocument, ProviderService as ProviderServiceEntity } from '../../database/entities';
import { AdminProvidersController, ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { ProviderStaffService } from './staff.service';

@Module({
  imports: [TypeOrmModule.forFeature([Provider, ProviderBranch, ProviderServiceEntity, ProviderDocument])],
  providers: [ProvidersService, ProviderStaffService],
  controllers: [ProvidersController, AdminProvidersController],
  exports: [ProvidersService],
})
export class ProvidersModule {}
