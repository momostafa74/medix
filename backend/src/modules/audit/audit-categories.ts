/**
 * Groups audit actions so reviewers can filter "who read medical data", "money", "sign-ins"…
 * Patterns are PostgreSQL regexes (also used in SQL filters). First match wins for labelling.
 */
export const AUDIT_CATEGORIES = {
  AUTH: { label: 'الدخول والأمان', pattern: '^(LOGIN|LOGOUT|USER_REGISTERED|PASSWORD|TWO_FACTOR|ACCOUNT_|NEW_DEVICE|REFRESH_TOKEN|FORCE_LOGOUT)' },
  MEDICAL_ACCESS: { label: 'الاطلاع على بيانات طبية', pattern: '(_VIEWED|_DOWNLOADED|VIEWED_BY|^MEDICAL_|LOOKUP_FAILED)' },
  FINANCE: { label: 'المالية', pattern: '^(PAYMENT|COUPON|COMMISSION|SETTLEMENT|SUBSCRIPTION)' },
  BOOKINGS: { label: 'الحجوزات والطلبات', pattern: '^(APPOINTMENT|LAB_ORDER|RADIOLOGY_(BOOKED|CANCELLED|PAID|STATUS)|PHARMACY_ORDER|SCHEDULE|LAB_SAMPLE|PRESCRIPTION_(CREATED|DISPENSED|REVOKED))' },
  ADMIN: { label: 'الإدارة والصلاحيات', pattern: '^(SETTING|ROLE_|USER_ROLES|USER_STATUS|STAFF_USER|PROVIDER_|SPECIALTY|REVIEW_MODERATED|CHAT_)' },
  CATALOG: { label: 'الكتالوج والإعدادات التشغيلية', pattern: '^(LAB_(TEST|PACKAGE|SETTINGS)|RADIOLOGY_(SERVICE|SETTINGS|DEVICES)|PHARMACY_(INVENTORY|SETTINGS|STATUS)|MEDICINE_|BRANCH_|DOCTOR_PROFILE)' },
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

export function auditCategoryOf(action: string): AuditCategory | 'OTHER' {
  for (const [k, v] of Object.entries(AUDIT_CATEGORIES)) if (new RegExp(v.pattern).test(action)) return k as AuditCategory;
  return 'OTHER';
}
