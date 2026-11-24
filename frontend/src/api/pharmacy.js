import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from './client';

const get = (url) => api.get(url).then((r) => r.data);

export const PH_STATUS = {
  PENDING: { label: 'طلب جديد', color: 'warning' },
  CONFIRMED: { label: 'تم التأكيد', color: 'primary' },
  PREPARING: { label: 'جاري التجهيز', color: 'info' },
  READY: { label: 'جاهز', color: 'secondary' },
  OUT_FOR_DELIVERY: { label: 'خرج للتوصيل', color: 'info' },
  DELIVERED: { label: 'تم التسليم', color: 'success' },
  CANCELLED: { label: 'ملغي', color: 'default' },
};

export const PH_NEXT_LABEL = {
  PREPARING: 'بدء التجهيز',
  READY: 'الطلب جاهز',
  OUT_FOR_DELIVERY: 'خروج للتوصيل',
  DELIVERED: 'تم التسليم',
};

export const RX_STATE = {
  ACTIVE: { label: 'سارية', color: 'success' },
  DISPENSED: { label: 'تم صرفها', color: 'primary' },
  REVOKED: { label: 'ملغاة', color: 'error' },
  EXPIRED: { label: 'منتهية', color: 'default' },
};

export const FULFILLMENT = { DELIVERY: 'توصيل للمنزل', PICKUP: 'استلام من الصيدلية' };

/** Tracking stages shown to the patient (pickup orders skip "out for delivery"). */
export const phStages = (fulfillment) => [
  { label: 'تم الطلب', statuses: ['PENDING'] },
  { label: 'تأكيد الصيدلية', statuses: ['CONFIRMED'] },
  { label: 'التجهيز', statuses: ['PREPARING', 'READY'] },
  ...(fulfillment === 'DELIVERY' ? [{ label: 'في الطريق', statuses: ['OUT_FOR_DELIVERY'] }] : []),
  { label: fulfillment === 'DELIVERY' ? 'تم التوصيل' : 'تم الاستلام', statuses: ['DELIVERED'] },
];

export const medName = (m) => {
  if (!m) return '';
  const squash = (v) => v.toLowerCase().replace(/\s+/g, '');
  const num = (v) => squash(v).replace(/[a-zµ%]+$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inName = (v) => squash(m.nameEn).includes(squash(v)) || (/^\d[\d.]*$/.test(squash(v).replace(/[a-zµ%]+$/i, '')) && new RegExp(`(^|\\D)${num(v)}(\\D|$)`).test(squash(m.nameEn)));
  return [m.nameEn, m.strength && !inName(m.strength) ? m.strength : null, m.form].filter(Boolean).join(' ');
};

export const useMedicineSearch = (params, enabled = true) =>
  useQuery({ queryKey: ['medicines', 'search', params], queryFn: () => get(`/medicines/search${qs(params)}`), placeholderData: keepPreviousData, enabled });
export const useMedicine = (id, cityId) => useQuery({ queryKey: ['medicines', id, cityId], queryFn: () => get(`/medicines/${id}${qs({ cityId })}`), enabled: !!id });
export const usePharmacyProfile = (key) => useQuery({ queryKey: ['pharmacy', 'profile', key], queryFn: () => get(`/pharmacies/${encodeURIComponent(key)}/profile`), enabled: !!key });
export const usePharmacyItems = (key, params) =>
  useQuery({ queryKey: ['pharmacy', 'items', key, params], queryFn: () => get(`/pharmacies/${encodeURIComponent(key)}/items${qs(params)}`), enabled: !!key, placeholderData: keepPreviousData });

export const useMyPharmacy = () => useQuery({ queryKey: ['pharmacy', 'me'], queryFn: () => get('/pharmacy/me') });
export const useInventory = (params) => useQuery({ queryKey: ['pharmacy', 'inventory', params], queryFn: () => get(`/pharmacy/me/inventory${qs(params)}`), placeholderData: keepPreviousData });

export const usePhOrder = (id) => useQuery({ queryKey: ['pharmacy-orders', id], queryFn: () => get(`/pharmacy-orders/${id}`), enabled: !!id });
export const usePhOrders = (scope, params) =>
  useQuery({
    queryKey: ['pharmacy-orders', scope, params],
    queryFn: () => get(`${scope === 'pharmacy' ? '/pharmacy/me/orders' : scope === 'admin' ? '/pharmacy-orders/admin' : '/pharmacy-orders/mine'}${qs(params)}`),
    placeholderData: keepPreviousData,
  });

export const usePrescription = (id) => useQuery({ queryKey: ['prescriptions', id], queryFn: () => get(`/prescriptions/${id}`), enabled: !!id });
export const usePrescriptions = (scope, params) =>
  useQuery({ queryKey: ['prescriptions', scope, params], queryFn: () => get(`/prescriptions/${scope === 'doctor' ? 'written' : 'mine'}${qs(params)}`), placeholderData: keepPreviousData });

export const downloadRx = (rx) => downloadFile(`/prescriptions/${rx.id}/pdf`, `prescription-${rx.code}.pdf`);
