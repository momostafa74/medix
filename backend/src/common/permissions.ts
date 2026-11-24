import { RoleCode } from '../database/entities/enums';

/**
 * Permission catalog. Permissions answer "may this kind of user perform this
 * kind of action?". Ownership / provider-relationship ("may THIS user touch
 * THIS record?") is always checked additionally inside the services.
 */
export const P = {
  // users & access
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  // providers
  PROVIDERS_READ_ANY: 'providers.read.any',
  PROVIDERS_APPROVE: 'providers.approve',
  PROVIDERS_MANAGE_ANY: 'providers.manage.any',
  PROVIDER_MANAGE_OWN: 'provider.manage.own',
  // catalog
  SPECIALTIES_MANAGE: 'specialties.manage',
  LOCATIONS_MANAGE: 'locations.manage',
  // doctors
  DOCTOR_PROFILE_OWN: 'doctor.profile.own',
  SCHEDULES_MANAGE_OWN: 'schedules.manage.own',
  // appointments
  APPOINTMENTS_BOOK: 'appointments.book',
  APPOINTMENTS_READ_OWN: 'appointments.read.own',
  APPOINTMENTS_READ_PROVIDER: 'appointments.read.provider',
  APPOINTMENTS_MANAGE_PROVIDER: 'appointments.manage.provider',
  APPOINTMENTS_READ_ANY: 'appointments.read.any',
  APPOINTMENTS_MANAGE_ANY: 'appointments.manage.any',
  // patients & medical records
  PATIENT_PROFILE_OWN: 'patient.profile.own',
  MEDICAL_RECORD_OWN: 'medical_record.own',
  MEDICAL_RECORD_READ_PATIENT: 'medical_record.read.patient',
  PATIENTS_READ_ANY: 'patients.read.any',
  // engagement
  REVIEWS_WRITE: 'reviews.write',
  REVIEWS_MODERATE: 'reviews.moderate',
  FAVORITES_OWN: 'favorites.own',
  // files
  FILES_UPLOAD: 'files.upload',
  // laboratories
  LAB_ORDERS_BOOK: 'lab.orders.book',
  LAB_CATALOG_MANAGE: 'lab.catalog.manage',
  LAB_ORDERS_MANAGE: 'lab.orders.manage',
  LAB_RESULTS_ENTER: 'lab.results.enter',
  LAB_RESULTS_REVIEW: 'lab.results.review',
  LAB_RESULTS_APPROVE: 'lab.results.approve',
  /** Platform view of lab orders (operational metadata only — never result values). */
  LAB_ORDERS_READ_ANY: 'lab.orders.read.any',
  // radiology
  RADIOLOGY_ORDERS_BOOK: 'radiology.orders.book',
  RADIOLOGY_CATALOG_MANAGE: 'radiology.catalog.manage',
  RADIOLOGY_ORDERS_MANAGE: 'radiology.orders.manage',
  RADIOLOGY_REPORTS_WRITE: 'radiology.reports.write',
  RADIOLOGY_REPORTS_APPROVE: 'radiology.reports.approve',
  /** Platform view of radiology bookings (metadata only — never reports or images). */
  RADIOLOGY_ORDERS_READ_ANY: 'radiology.orders.read.any',
  // prescriptions & pharmacy
  PRESCRIPTIONS_WRITE: 'prescriptions.write',
  /** Pharmacist: open a prescription from its QR/code and record dispensing. */
  PRESCRIPTIONS_VERIFY: 'prescriptions.verify',
  PHARMACY_ORDERS_PLACE: 'pharmacy.orders.place',
  PHARMACY_CATALOG_MANAGE: 'pharmacy.catalog.manage',
  PHARMACY_ORDERS_MANAGE: 'pharmacy.orders.manage',
  /** Platform view of pharmacy orders (metadata only — never the medicines). */
  PHARMACY_ORDERS_READ_ANY: 'pharmacy.orders.read.any',
  MEDICINES_MANAGE: 'medicines.manage',
  // payments, commission, coupons, subscriptions (Phase 7)
  /** Patient pays online for their own bookings / orders. */
  PAYMENTS_PAY: 'payments.pay',
  /** Provider admin: earnings statement, payments received. */
  PAYMENTS_READ_PROVIDER: 'payments.read.provider',
  PAYMENTS_REFUND: 'payments.refund',
  COMMISSION_MANAGE: 'commission.manage',
  COUPONS_MANAGE: 'coupons.manage',
  /** Platform: plans, provider subscriptions, transfer approvals. */
  SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',
  SETTLEMENTS_MANAGE: 'settlements.manage',
  // chat
  CHAT_USE: 'chat.use',
  /** Platform team inbox: support conversations, admin↔provider, moderation of reported chats. */
  CHAT_SUPPORT: 'chat.support',
  // admin
  DASHBOARD_ADMIN: 'dashboard.admin',
  DASHBOARD_PROVIDER: 'dashboard.provider',
  AUDIT_READ: 'audit.read',
  SETTINGS_MANAGE: 'settings.manage',
  REPORTS_READ_ANY: 'reports.read.any',
  FINANCE_READ: 'finance.read',
  // security, analytics & operations (Phase 8)
  /** Platform analytics: KPIs with period comparison, breakdowns, cohorts, exports. */
  ANALYTICS_READ: 'analytics.read',
  SECURITY_READ: 'security.read',
  /** Unlock accounts, reset two-step verification, sign users out everywhere. */
  SECURITY_MANAGE: 'security.manage',
  /** Server/database health, slow endpoints, cache. */
  SYSTEM_HEALTH: 'system.health',
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(P);

const common = [P.FILES_UPLOAD, P.CHAT_USE];
const providerAdmin = [P.PROVIDER_MANAGE_OWN, P.DASHBOARD_PROVIDER, P.PAYMENTS_READ_PROVIDER, ...common];

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  [RoleCode.SUPER_ADMIN]: [...ALL_PERMISSIONS],
  [RoleCode.ADMIN]: ALL_PERMISSIONS.filter((p) => p !== P.ROLES_MANAGE),
  [RoleCode.SUPPORT]: [
    P.USERS_READ,
    P.PROVIDERS_READ_ANY,
    P.APPOINTMENTS_READ_ANY,
    P.APPOINTMENTS_MANAGE_ANY,
    P.PATIENTS_READ_ANY,
    P.DASHBOARD_ADMIN,
    P.CHAT_SUPPORT,
    P.LAB_ORDERS_READ_ANY,
    P.RADIOLOGY_ORDERS_READ_ANY,
    P.PHARMACY_ORDERS_READ_ANY,
    P.SECURITY_READ,
    P.SECURITY_MANAGE,
    ...common,
  ],
  [RoleCode.ACCOUNTANT]: [
    P.DASHBOARD_ADMIN,
    P.REPORTS_READ_ANY,
    P.FINANCE_READ,
    P.PROVIDERS_READ_ANY,
    P.LAB_ORDERS_READ_ANY,
    P.RADIOLOGY_ORDERS_READ_ANY,
    P.PHARMACY_ORDERS_READ_ANY,
    P.PAYMENTS_REFUND,
    P.SUBSCRIPTIONS_MANAGE,
    P.SETTLEMENTS_MANAGE,
    P.ANALYTICS_READ,
  ],
  [RoleCode.DOCTOR]: [
    ...providerAdmin,
    P.DOCTOR_PROFILE_OWN,
    P.SCHEDULES_MANAGE_OWN,
    P.APPOINTMENTS_READ_PROVIDER,
    P.APPOINTMENTS_MANAGE_PROVIDER,
    P.MEDICAL_RECORD_READ_PATIENT,
    P.PRESCRIPTIONS_WRITE,
  ],
  [RoleCode.LAB_ADMIN]: [
    ...providerAdmin,
    P.MEDICAL_RECORD_READ_PATIENT,
    P.LAB_CATALOG_MANAGE,
    P.LAB_ORDERS_MANAGE,
    P.LAB_RESULTS_ENTER,
    P.LAB_RESULTS_REVIEW,
    P.LAB_RESULTS_APPROVE,
  ],
  [RoleCode.LAB_STAFF]: [P.DASHBOARD_PROVIDER, P.LAB_ORDERS_MANAGE, P.LAB_RESULTS_ENTER, P.LAB_RESULTS_REVIEW, ...common],
  [RoleCode.RADIOLOGY_ADMIN]: [
    ...providerAdmin,
    P.MEDICAL_RECORD_READ_PATIENT,
    P.RADIOLOGY_CATALOG_MANAGE,
    P.RADIOLOGY_ORDERS_MANAGE,
    P.RADIOLOGY_REPORTS_WRITE,
    P.RADIOLOGY_REPORTS_APPROVE,
  ],
  [RoleCode.RADIOLOGY_STAFF]: [P.DASHBOARD_PROVIDER, P.RADIOLOGY_ORDERS_MANAGE, P.RADIOLOGY_REPORTS_WRITE, ...common],
  [RoleCode.PHARMACY_ADMIN]: [...providerAdmin, P.PHARMACY_CATALOG_MANAGE, P.PHARMACY_ORDERS_MANAGE, P.PRESCRIPTIONS_VERIFY],
  [RoleCode.PHARMACY_STAFF]: [P.DASHBOARD_PROVIDER, P.PHARMACY_ORDERS_MANAGE, P.PRESCRIPTIONS_VERIFY, ...common],
  [RoleCode.PATIENT]: [
    P.PATIENT_PROFILE_OWN,
    P.MEDICAL_RECORD_OWN,
    P.APPOINTMENTS_BOOK,
    P.APPOINTMENTS_READ_OWN,
    P.REVIEWS_WRITE,
    P.FAVORITES_OWN,
    P.LAB_ORDERS_BOOK,
    P.RADIOLOGY_ORDERS_BOOK,
    P.PHARMACY_ORDERS_PLACE,
    P.PAYMENTS_PAY,
    ...common,
  ],
};

export const ROLE_NAMES: Record<RoleCode, { ar: string; en: string }> = {
  [RoleCode.SUPER_ADMIN]: { ar: 'مدير النظام الأعلى', en: 'Super Admin' },
  [RoleCode.ADMIN]: { ar: 'مدير', en: 'Admin' },
  [RoleCode.DOCTOR]: { ar: 'طبيب', en: 'Doctor' },
  [RoleCode.LAB_ADMIN]: { ar: 'مدير معمل', en: 'Lab Admin' },
  [RoleCode.LAB_STAFF]: { ar: 'موظف معمل', en: 'Lab Staff' },
  [RoleCode.RADIOLOGY_ADMIN]: { ar: 'مدير مركز أشعة', en: 'Radiology Admin' },
  [RoleCode.RADIOLOGY_STAFF]: { ar: 'موظف أشعة', en: 'Radiology Staff' },
  [RoleCode.PHARMACY_ADMIN]: { ar: 'مدير صيدلية', en: 'Pharmacy Admin' },
  [RoleCode.PHARMACY_STAFF]: { ar: 'موظف صيدلية', en: 'Pharmacy Staff' },
  [RoleCode.PATIENT]: { ar: 'مريض', en: 'Patient' },
  [RoleCode.SUPPORT]: { ar: 'دعم فني', en: 'Support' },
  [RoleCode.ACCOUNTANT]: { ar: 'محاسب', en: 'Accountant' },
};
