/**
 * Payment gateway seam. Business logic only talks to this interface; the concrete
 * gateway is chosen by configuration (PAYMENT_GATEWAY), never hard-coded.
 */
export interface CheckoutRequest {
  paymentId: string;
  code: string;
  amount: number;
  currency: string;
  description: string;
  customer: { name: string; phone?: string | null; email?: string | null };
}

export interface CheckoutSession {
  /** Where the browser goes to pay. */
  redirectUrl: string;
  /** Gateway-side reference (order id / session id). */
  reference: string;
}

export interface GatewayResult {
  /** Our payment code (merchant reference). */
  code: string;
  success: boolean;
  /** Gateway transaction id (needed for refunds). */
  transactionId: string;
  amount?: number;
  failureReason?: string;
}

export interface PaymentGateway {
  readonly name: string;
  readonly label: string;
  isConfigured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  refund(transactionId: string, amount: number): Promise<{ ok: boolean; reference: string | null; error?: string }>;
}

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
