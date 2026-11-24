import { Global, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CouponsService } from './coupons.service';
import { FinanceService } from './finance.service';
import { SandboxGateway } from './gateways/sandbox.gateway';
import { PaymobGateway } from './gateways/paymob.gateway';
import { PAYMENT_GATEWAYS } from './gateways/gateway';
import { FinanceController, PaymentsController } from './payments.controller';

@Global()
@Module({
  providers: [
    SandboxGateway,
    PaymobGateway,
    { provide: PAYMENT_GATEWAYS, useFactory: (s: SandboxGateway, p: PaymobGateway) => [s, p], inject: [SandboxGateway, PaymobGateway] },
    PaymentsService,
    CouponsService,
    FinanceService,
  ],
  controllers: [PaymentsController, FinanceController],
  exports: [PaymentsService, CouponsService, FinanceService],
})
export class PaymentsModule {}
