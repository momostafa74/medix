import { Global, Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsAdminController, SubscriptionsController } from './subscriptions.controller';

@Global()
@Module({
  providers: [SubscriptionsService],
  controllers: [SubscriptionsController, SubscriptionsAdminController],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
