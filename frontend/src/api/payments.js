import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from './client';

const get = (url) => api.get(url).then((r) => r.data);

export const PAYMENT_STATUS = {
  PENDING: { label: 'بانتظار الدفع', color: 'warning' },
  PAID: { label: 'مدفوع', color: 'success' },
  FAILED: { label: 'فشلت', color: 'error' },
  REFUNDED: { label: 'مسترد', color: 'default' },
  PARTIALLY_REFUNDED: { label: 'مسترد جزئياً', color: 'info' },
};

export const PAY_METHOD = { CASH: 'نقدي', CARD: 'بطاقة', ONLINE: 'دفع إلكتروني', WALLET: 'محفظة / تحويل', INSTAPAY: 'InstaPay', VODAFONE_CASH: 'فودافون كاش', BANK_TRANSFER: 'تحويل بنكي' };

export const ENTITY_LABEL = { APPOINTMENT: 'كشف', LAB_ORDER: 'تحاليل', RADIOLOGY_ORDER: 'أشعة', PHARMACY_ORDER: 'صيدلية', SUBSCRIPTION: 'اشتراك' };

/** Where the patient sees the record a payment belongs to. */
export const patientRecordLink = (entityType, entityId) =>
  ({
    APPOINTMENT: '/patient/appointments',
    LAB_ORDER: `/patient/lab-orders/${entityId}`,
    RADIOLOGY_ORDER: `/patient/radiology/${entityId}`,
    PHARMACY_ORDER: `/patient/pharmacy-orders/${entityId}`,
  })[entityType];

export const SUB_STATUS = {
  TRIAL: { label: 'فترة تجريبية', color: 'info' },
  ACTIVE: { label: 'نشط', color: 'success' },
  GRACE: { label: 'فترة سماح', color: 'warning' },
  EXPIRED: { label: 'منتهي', color: 'error' },
};

export const INVOICE_STATUS = {
  PENDING: { label: 'بانتظار الدفع', color: 'warning' },
  AWAITING_REVIEW: { label: 'قيد المراجعة', color: 'info' },
  PAID: { label: 'مدفوعة', color: 'success' },
  REJECTED: { label: 'مرفوضة', color: 'error' },
  CANCELLED: { label: 'ملغاة', color: 'default' },
  FAILED: { label: 'فشلت', color: 'error' },
};

export const SERVICE_TYPE = { APPOINTMENT: 'كشوفات', LAB: 'تحاليل', RADIOLOGY: 'أشعة', PHARMACY: 'صيدلية', SUBSCRIPTION: 'اشتراكات' };

export const usePaymentsConfig = () => useQuery({ queryKey: ['payments', 'config'], queryFn: () => get('/payments/config'), staleTime: 300_000 });
export const useRecordPayment = (type, id) =>
  useQuery({ queryKey: ['payments', 'record', type, id], queryFn: () => get(`/payments/record/${type}/${id}`), enabled: !!(type && id) });
export const usePayment = (id, opts = {}) => useQuery({ queryKey: ['payments', id], queryFn: () => get(`/payments/${id}`), enabled: !!id, ...opts });
export const usePayments = (scope, params) => useQuery({ queryKey: ['payments', scope, params], queryFn: () => get(`/payments/${scope}${qs(params)}`), placeholderData: (p) => p });
export const useMySubscription = (enabled = true) => useQuery({ queryKey: ['subscription', 'me'], queryFn: () => get('/subscriptions/me'), enabled });
export const useStatement = (params) => useQuery({ queryKey: ['finance', 'statement', params], queryFn: () => get(`/finance/statement${qs(params)}`) });

export const downloadReceipt = (p) => downloadFile(`/payments/${p.id}/receipt.pdf`, `receipt-${p.code}.pdf`);

/**
 * Sends the browser to the gateway. The sandbox page is part of this app, so it is opened on the
 * current origin (keeps the session even if FRONTEND_URL is spelled differently, e.g. 127.0.0.1).
 */
export function goToGateway(url) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith('/pay/sandbox/')) return window.location.assign(u.pathname + u.search);
  } catch {
    /* fall through */
  }
  return window.location.assign(url);
}

/** Starts an online payment for a booking/order and sends the browser to the gateway. */
export async function startCheckout(entityType, entityId) {
  const { data } = await api.post('/payments/checkout', { entityType, entityId });
  goToGateway(data.redirectUrl);
  return data;
}

export const previewCoupon = (body) => api.post('/payments/coupons/preview', body).then((r) => r.data);

/** Days left until a date (negative when past). */
export const daysUntil = (d) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);
