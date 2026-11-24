import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification, NotificationPreference, User } from '../../database/entities';
import { JobQueueService } from '../../common/jobs/job-queue.service';
import { EmailChannel, SmsChannel, WhatsAppChannel } from './channels';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, NotificationPreference, User]), JwtModule.register({})],
  providers: [NotificationsService, NotificationsGateway, EmailChannel, SmsChannel, WhatsAppChannel, JobQueueService],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationsGateway, JobQueueService, EmailChannel, SmsChannel],
})
export class NotificationsModule {}
