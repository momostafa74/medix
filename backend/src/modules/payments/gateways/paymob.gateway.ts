import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { paymobHmac, safeEqual } from '../payments-logic';
import { CheckoutRequest, CheckoutSession, GatewayResult, PaymentGateway } from './gateway';

/**
 * Paymob Accept (Egypt) — card iframe flow:
 *   auth token → order (merchant_order_id = our payment code) → payment key → iframe URL.
 * Results arrive on the server-to-server "transaction processed" callback, verified with
 * the account HMAC secret (SHA-512 over the documented fields). Refunds use void_refund/refund.
 */
@Injectable()
export class PaymobGateway implements PaymentGateway {
  readonly name = 'paymob';
  readonly label = 'Paymob';
  private readonly logger = new Logger('Paymob');
  private readonly cfg: Record<string, string | undefined>;

  constructor(config: ConfigService) {
    this.cfg = {
      base: config.get('payment.paymobBaseUrl'),
      apiKey: config.get('payment.paymobApiKey'),
      integrationId: config.get('payment.paymobIntegrationId'),
      iframeId: config.get('payment.paymobIframeId'),
      hmac: config.get('payment.paymobHmacSecret'),
    };
  }

  isConfigured() {
    return !!(this.cfg.apiKey && this.cfg.integrationId && this.cfg.iframeId && this.cfg.hmac);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.warn(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
      throw new ServiceUnavailableException('تعذر الاتصال ببوابة الدفع، حاول مرة أخرى');
    }
    return json as T;
  }

  private async token() {
    const { token } = await this.post<{ token: string }>('/api/auth/tokens', { api_key: this.cfg.apiKey });
    return token;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('بوابة الدفع غير مهيأة');
    const cents = Math.round(req.amount * 100);
    const auth = await this.token();
    const order = await this.post<{ id: number }>('/api/ecommerce/orders', {
      auth_token: auth,
      delivery_needed: false,
      amount_cents: cents,
      currency: req.currency,
      merchant_order_id: req.code,
      items: [{ name: req.description.slice(0, 50), amount_cents: cents, quantity: 1 }],
    });
    const [first, ...rest] = (req.customer.name || 'Customer').split(/\s+/);
    const key = await this.post<{ token: string }>('/api/acceptance/payment_keys', {
      auth_token: auth,
      amount_cents: cents,
      expiration: 3600,
      order_id: order.id,
      currency: req.currency,
      integration_id: Number(this.cfg.integrationId),
      billing_data: {
        first_name: first || 'NA',
        last_name: rest.join(' ') || 'NA',
        email: req.customer.email || 'na@medix.local',
        phone_number: req.customer.phone || 'NA',
        apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', shipping_method: 'NA', postal_code: 'NA', city: 'NA', country: 'EG', state: 'NA',
      },
    });
    return { redirectUrl: `${this.cfg.base}/api/acceptance/iframes/${this.cfg.iframeId}?payment_token=${key.token}`, reference: String(order.id) };
  }

  /** Verifies and parses the processed-transaction callback. Returns null when the signature is wrong. */
  parseCallback(body: any, hmac: string): GatewayResult | null {
    const obj = body?.obj;
    if (!obj || !this.cfg.hmac || !safeEqual(paymobHmac(obj, this.cfg.hmac), String(hmac || ''))) return null;
    const success = obj.success === true || obj.success === 'true';
    return {
      code: String(obj.order?.merchant_order_id ?? ''),
      success: success && !(obj.pending === true || obj.pending === 'true'),
      transactionId: String(obj.id),
      amount: Number(obj.amount_cents) / 100,
      failureReason: success ? undefined : String(obj.data?.message || 'رُفضت العملية'),
    };
  }

  /** The browser redirect carries the same fields flattened in the query string. */
  parseReturn(query: Record<string, string>): GatewayResult | null {
    const obj: Record<string, any> = { order: { id: query.order }, source_data: { pan: query['source_data.pan'], sub_type: query['source_data.sub_type'], type: query['source_data.type'] } };
    for (const [k, v] of Object.entries(query)) if (!k.includes('.') && k !== 'order') obj[k] = v;
    if (!this.cfg.hmac || !safeEqual(paymobHmac(obj, this.cfg.hmac), String(query.hmac || ''))) return null;
    return { code: String(query.merchant_order_id ?? ''), success: query.success === 'true' && query.pending !== 'true', transactionId: String(query.id) };
  }

  async refund(transactionId: string, amount: number) {
    try {
      const auth = await this.token();
      const r = await this.post<{ id: number; success: boolean }>('/api/acceptance/void_refund/refund', { auth_token: auth, transaction_id: Number(transactionId), amount_cents: Math.round(amount * 100) });
      return { ok: !!r.success, reference: r.id ? String(r.id) : null, error: r.success ? undefined : 'رفضت البوابة الاسترداد' };
    } catch (e: any) {
      return { ok: false, reference: null, error: e.message };
    }
  }
}
