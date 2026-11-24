import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from './client';

const get = (url) => api.get(url).then((r) => r.data);

export const LAB_STATUS = {
  NEW_ORDER: { label: 'طلب جديد', color: 'warning' },
  PAID: { label: 'تم الدفع', color: 'primary' },
  SAMPLE_COLLECTED: { label: 'تم سحب العينة', color: 'info' },
  SAMPLE_RECEIVED: { label: 'العينة بالمعمل', color: 'info' },
  PROCESSING: { label: 'جاري التحليل', color: 'info' },
  RESULT_ENTERED: { label: 'تم إدخال النتائج', color: 'secondary' },
  UNDER_REVIEW: { label: 'قيد المراجعة', color: 'secondary' },
  APPROVED: { label: 'النتيجة جاهزة', color: 'success' },
  DELIVERED: { label: 'تم التسليم', color: 'success' },
  CANCELLED: { label: 'ملغي', color: 'default' },
};

/** The happy path shown as a progress track. */
export const LAB_FLOW = ['NEW_ORDER', 'PAID', 'SAMPLE_COLLECTED', 'SAMPLE_RECEIVED', 'PROCESSING', 'RESULT_ENTERED', 'UNDER_REVIEW', 'APPROVED', 'DELIVERED'];

/** Patient-facing simplified stages. */
export const PATIENT_STAGES = [
  { label: 'تم الحجز', statuses: ['NEW_ORDER', 'PAID'] },
  { label: 'سحب العينة', statuses: ['SAMPLE_COLLECTED', 'SAMPLE_RECEIVED'] },
  { label: 'جاري التحليل', statuses: ['PROCESSING', 'RESULT_ENTERED', 'UNDER_REVIEW'] },
  { label: 'النتيجة جاهزة', statuses: ['APPROVED', 'DELIVERED'] },
];

export const FLAG = {
  NORMAL: { label: 'طبيعي', color: 'success' },
  HIGH: { label: 'مرتفع', color: 'warning' },
  LOW: { label: 'منخفض', color: 'warning' },
  CRITICAL: { label: 'حرج', color: 'error' },
};

export const PAYMENT_METHOD = { CASH: 'نقدي', CARD: 'بطاقة', ONLINE: 'أونلاين', WALLET: 'محفظة' };

export const NEXT_ACTION_LABEL = {
  PAID: 'تسجيل الدفع',
  SAMPLE_COLLECTED: 'تم سحب العينة',
  SAMPLE_RECEIVED: 'استلام العينة بالمعمل',
  PROCESSING: 'بدء التحليل',
  DELIVERED: 'تم تسليم النتيجة',
};

export const useLabCatalog = (key) => useQuery({ queryKey: ['lab', 'catalog', key], queryFn: () => get(`/labs/${encodeURIComponent(key)}/catalog`), enabled: !!key });
export const useMyLab = () => useQuery({ queryKey: ['lab', 'me'], queryFn: () => get('/labs/me') });
export const useLabOrder = (id) => useQuery({ queryKey: ['lab-orders', id], queryFn: () => get(`/lab-orders/${id}`), enabled: !!id });
export const useLabOrders = (scope, params) =>
  useQuery({
    queryKey: ['lab-orders', scope, params],
    queryFn: () => get(`${scope === 'lab' ? '/labs/me/orders' : scope === 'admin' ? '/lab-orders/admin' : '/lab-orders/mine'}${qs(params)}`),
    placeholderData: (p) => p,
  });

export const downloadLabReport = (order) => downloadFile(`/lab-orders/${order.id}/report.pdf`, `lab-report-${order.code}.pdf`);

/** Minutes ↔ "HH:mm". */
export const toHHmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fromHHmm = (s) => {
  const [h, m] = String(s || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};
