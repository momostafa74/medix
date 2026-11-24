export const APPOINTMENT_STATUS = {
  PENDING: { label: 'بانتظار التأكيد', color: 'warning' },
  CONFIRMED: { label: 'مؤكد', color: 'primary' },
  CHECKED_IN: { label: 'تم الحضور', color: 'info' },
  IN_PROGRESS: { label: 'جاري الكشف', color: 'info' },
  COMPLETED: { label: 'مكتمل', color: 'success' },
  CANCELLED: { label: 'ملغي', color: 'default' },
  NO_SHOW: { label: 'لم يحضر', color: 'error' },
  RESCHEDULED: { label: 'تم تغيير الموعد', color: 'default' },
};
export const APPOINTMENT_TYPE = { CLINIC: 'في العيادة', ONLINE: 'أونلاين', HOME: 'زيارة منزلية' };
export const VERIFICATION = {
  PENDING: { label: 'قيد المراجعة', color: 'warning' },
  APPROVED: { label: 'معتمد', color: 'success' },
  REJECTED: { label: 'مرفوض', color: 'error' },
  SUSPENDED: { label: 'موقوف', color: 'default' },
};
export const PROVIDER_TYPE = {
  DOCTOR: 'طبيب',
  LABORATORY: 'معمل تحاليل',
  RADIOLOGY: 'مركز أشعة',
  PHARMACY: 'صيدلية',
  HOSPITAL: 'مستشفى',
  HOME_CARE: 'رعاية منزلية',
};
export const USER_STATUS = {
  ACTIVE: { label: 'نشط', color: 'success' },
  INACTIVE: { label: 'غير نشط', color: 'default' },
  SUSPENDED: { label: 'موقوف', color: 'error' },
  PENDING_VERIFICATION: { label: 'بانتظار التفعيل', color: 'warning' },
};
export const ROLE_LABEL = {
  SUPER_ADMIN: 'مدير النظام الأعلى',
  ADMIN: 'مدير',
  DOCTOR: 'طبيب',
  LAB_ADMIN: 'مدير معمل',
  LAB_STAFF: 'موظف معمل',
  RADIOLOGY_ADMIN: 'مدير مركز أشعة',
  RADIOLOGY_STAFF: 'موظف أشعة',
  PHARMACY_ADMIN: 'مدير صيدلية',
  PHARMACY_STAFF: 'موظف صيدلية',
  PATIENT: 'مريض',
  SUPPORT: 'دعم فني',
  ACCOUNTANT: 'محاسب',
};
export const GENDER = { MALE: 'ذكر', FEMALE: 'أنثى' };
export const SEVERITY = { MILD: 'بسيطة', MODERATE: 'متوسطة', SEVERE: 'شديدة' };
export const DOC_TYPE = { REPORT: 'تقرير طبي', PRESCRIPTION: 'روشتة', REFERRAL: 'تحويل', LAB: 'تحليل', RADIOLOGY: 'أشعة', OTHER: 'أخرى' };
export const PROVIDER_DOC_TYPE = {
  LICENSE: 'ترخيص مزاولة المهنة',
  NATIONAL_ID: 'بطاقة الرقم القومي',
  SYNDICATE_CARD: 'كارنيه النقابة',
  COMMERCIAL_REGISTER: 'سجل تجاري',
  TAX_CARD: 'بطاقة ضريبية',
  CERTIFICATE: 'شهادة',
  OTHER: 'أخرى',
};
export const LANGUAGES = { ar: 'العربية', en: 'الإنجليزية', fr: 'الفرنسية', de: 'الألمانية' };
