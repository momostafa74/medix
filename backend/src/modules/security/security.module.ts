import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuditRetentionService } from './audit-retention.service';

@Module({
  providers: [SecurityService, AuditRetentionService],
  controllers: [SecurityController],
})
export class SecurityModule {}
