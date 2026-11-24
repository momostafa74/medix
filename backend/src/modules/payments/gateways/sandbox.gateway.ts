import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { signSandbox } from '../payments-logic';
import { CheckoutRequest, CheckoutSession, PaymentGateway } from './gateway';

/**
 * Built-in test gateway: a hosted checkout page in the SPA (/pay/sandbox/:id) that posts a
 * signed result back. Lets the whole online flow (redirect → callback → paid → refund) run
 * without merchant credentials. Disabled in production unless PAYMENT_GATEWAY=sandbox is explicit.
 */
@Injectable()
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';
  readonly label = 'بوابة تجريبية';
  private readonly secret: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('payment.sandboxSecret')!;
    this.frontendUrl = config.get<string>('frontendUrl')!.replace(/\/$/, '');
  }

  isConfigured() {
    return true;
  }

  sign(paymentId: string, amount: number) {
    return signSandbox(this.secret, paymentId, amount);
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const sig = this.sign(req.paymentId, req.amount);
    return { redirectUrl: `${this.frontendUrl}/pay/sandbox/${req.paymentId}?sig=${sig}`, reference: `SBX-${req.code}` };
  }

  async refund(_transactionId: string, _amount: number) {
    return { ok: true, reference: `SBX-RF-${randomBytes(4).toString('hex').toUpperCase()}` };
  }
}
