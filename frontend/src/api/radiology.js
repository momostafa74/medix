import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from './client';

const get = (url) => api.get(url).then((r) => r.data);

export const RAD_STATUS = {
  BOOKED: { label: 'محجوز', color: 'warning' },
  CHECKED_IN: { label: 'تم الحضور', color: 'primary' },
  EXAMINATION: { label: 'جاري الفحص', color: 'info' },
  REPORTING: { label: 'كتابة التقرير', color: 'secondary' },
  APPROVED: { label: 'التقرير جاهز', color: 'success' },
  DELIVERED: { label: 'تم التسليم', color: 'success' },
  CANCELLED: { label: 'ملغي', color: 'default' },
  NO_SHOW: { label: 'لم يحضر', color: 'error' },
};

export const MODALITY = {
  XRAY: 'أشعة عادية',
  US: 'سونار',
  CT: 'أشعة مقطعية',
  MRI: 'رنين مغناطيسي',
  MAMMO: 'ماموجرام',
  DEXA: 'كثافة العظام',
  FLUORO: 'أشعة بالصبغة',
  ECHO: 'إيكو',
  OTHER: 'أخرى',
};

export const RAD_STAGES = [
  { label: 'تم الحجز', statuses: ['BOOKED'] },
  { label: 'الحضور والفحص', statuses: ['CHECKED_IN', 'EXAMINATION'] },
  { label: 'كتابة التقرير', statuses: ['REPORTING'] },
  { label: 'التقرير جاهز', statuses: ['APPROVED', 'DELIVERED'] },
];

export const RAD_NEXT_LABEL = {
  CHECKED_IN: 'تسجيل الحضور',
  EXAMINATION: 'بدء الفحص',
  REPORTING: 'انتهاء الفحص',
  NO_SHOW: 'لم يحضر',
  DELIVERED: 'تم تسليم التقرير',
};

export const useRadCatalog = (key) => useQuery({ queryKey: ['radiology', 'catalog', key], queryFn: () => get(`/radiology/${encodeURIComponent(key)}/catalog`), enabled: !!key });
export const useMyCenter = () => useQuery({ queryKey: ['radiology', 'me'], queryFn: () => get('/radiology-center/me') });
export const useRadOrder = (id) => useQuery({ queryKey: ['radiology-orders', id], queryFn: () => get(`/radiology-orders/${id}`), enabled: !!id });
export const useRadOrders = (scope, params) =>
  useQuery({
    queryKey: ['radiology-orders', scope, params],
    queryFn: () => get(`${scope === 'center' ? '/radiology-center/me/orders' : scope === 'admin' ? '/radiology-orders/admin' : '/radiology-orders/mine'}${qs(params)}`),
    placeholderData: (p) => p,
  });

export const downloadRadReport = (o) => downloadFile(`/radiology-orders/${o.id}/report.pdf`, `radiology-report-${o.code}.pdf`);
