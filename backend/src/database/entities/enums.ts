export enum UserStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export enum ProviderType {
  DOCTOR = 'DOCTOR',
  LABORATORY = 'LABORATORY',
  RADIOLOGY = 'RADIOLOGY',
  PHARMACY = 'PHARMACY',
  HOSPITAL = 'HOSPITAL',
  HOME_CARE = 'HOME_CARE',
}

export enum VerificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum AppointmentType {
  CLINIC = 'CLINIC',
  ONLINE = 'ONLINE',
  HOME = 'HOME',
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
}

/** Statuses that occupy a slot (used by the DB exclusion constraint too). */
export const ACTIVE_APPOINTMENT_STATUSES = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  ONLINE = 'ONLINE',
  WALLET = 'WALLET',
}

export enum ScheduleExceptionType {
  HOLIDAY = 'HOLIDAY',
  VACATION = 'VACATION',
  CUSTOM_HOURS = 'CUSTOM_HOURS',
}

export enum LabOrderStatus {
  NEW_ORDER = 'NEW_ORDER',
  PAID = 'PAID',
  SAMPLE_COLLECTED = 'SAMPLE_COLLECTED',
  SAMPLE_RECEIVED = 'SAMPLE_RECEIVED',
  PROCESSING = 'PROCESSING',
  RESULT_ENTERED = 'RESULT_ENTERED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum ResultFlag {
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  LOW = 'LOW',
  CRITICAL = 'CRITICAL',
}

export enum RadiologyOrderStatus {
  BOOKED = 'BOOKED',
  CHECKED_IN = 'CHECKED_IN',
  EXAMINATION = 'EXAMINATION',
  REPORTING = 'REPORTING',
  APPROVED = 'APPROVED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export enum PharmacyOrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum FulfillmentType {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
}

export enum HomeServiceType {
  LAB_SAMPLE = 'LAB_SAMPLE',
  NURSING = 'NURSING',
  MEDICAL = 'MEDICAL',
  RADIOLOGY = 'RADIOLOGY',
}

export enum HomeServiceStatus {
  REQUESTED = 'REQUESTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  ASSIGNED = 'ASSIGNED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

export enum CommissionScope {
  GLOBAL = 'GLOBAL',
  PROVIDER_TYPE = 'PROVIDER_TYPE',
  PROVIDER = 'PROVIDER',
}

export enum FileVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
}

export enum NotificationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  READ = 'READ',
}

export enum ChatRoomType {
  PATIENT_PROVIDER = 'PATIENT_PROVIDER',
  ADMIN_PROVIDER = 'ADMIN_PROVIDER',
  SUPPORT = 'SUPPORT',
}

export enum ReviewStatus {
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
  PENDING = 'PENDING',
}

export enum TokenPurpose {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/** Role codes. Specialties are data, NOT roles. */
export enum RoleCode {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  LAB_ADMIN = 'LAB_ADMIN',
  LAB_STAFF = 'LAB_STAFF',
  RADIOLOGY_ADMIN = 'RADIOLOGY_ADMIN',
  RADIOLOGY_STAFF = 'RADIOLOGY_STAFF',
  PHARMACY_ADMIN = 'PHARMACY_ADMIN',
  PHARMACY_STAFF = 'PHARMACY_STAFF',
  PATIENT = 'PATIENT',
  SUPPORT = 'SUPPORT',
  ACCOUNTANT = 'ACCOUNTANT',
}
