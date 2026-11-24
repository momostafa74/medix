/** Payments, commission, coupons, reviews, favorites (Phases 3 & 7). */
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn, Relation } from 'typeorm';
import { BaseEntityWithId, Money, TimestampedEntity, Tstz, Uuid } from './base';
import {
  CommissionScope,
  DiscountType,
  PaymentMethod,
  PaymentStatus,
  ProviderType,
  ReviewStatus,
} from './enums';
import type { Patient } from './patient.entities';
import type { Provider } from './provider.entities';
import type { Appointment } from './appointment.entities';

@Entity('payments')
@Index(['paidAt'])
@Index(['entityType', 'entityId'])
@Index(['providerId', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['patientId'])
@Check('payment_amounts_ck', `"amount" >= 0 AND "refunded_amount" >= 0 AND "refunded_amount" <= "amount"`)
export class Payment extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  /** Null for provider subscription payments. */
  @Uuid({ nullable: true })
  patientId!: string | null;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid()
  providerId!: string;

  @ManyToOne('Provider')
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid({ nullable: true })
  appointmentId!: string | null;

  @ManyToOne('Appointment', { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Relation<Appointment>;

  /** APPOINTMENT | LAB_ORDER | RADIOLOGY_ORDER | PHARMACY_ORDER | SUBSCRIPTION */
  @Column()
  entityType!: string;

  @Uuid()
  entityId!: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  method!: PaymentMethod;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @Money()
  amount!: number;

  @Column({ default: 'EGP' })
  currency!: string;

  /** Resolved through the PaymentGateway adapter registry — never hard-coded in business logic. */
  @Column({ type: 'varchar', nullable: true })
  gateway!: string | null;

  @Column({ type: 'varchar', nullable: true })
  gatewayReference!: string | null;

  @Tstz({ nullable: true })
  paidAt!: Date | null;

  /** User who paid (patient, or the provider admin for subscriptions). */
  @Uuid({ nullable: true })
  payerUserId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Money({ default: 0 })
  refundedAmount!: number;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  /** Who holds the money: PLATFORM (online) or PROVIDER (cash/card at the desk) — drives settlements. */
  @Column({ type: 'varchar', length: 10, default: 'PROVIDER' })
  collectedBy!: 'PLATFORM' | 'PROVIDER';

  /** Recorded by staff (cash/card at the desk) — null for online payments. */
  @Uuid({ nullable: true })
  recordedById!: string | null;
}

@Entity('refunds')
export class Refund extends BaseEntityWithId {
  @Uuid()
  paymentId!: string;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Relation<Payment>;

  @Money()
  amount!: number;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Uuid({ nullable: true })
  processedById!: string | null;

  /** COMPLETED | FAILED */
  @Column({ type: 'varchar', length: 12, default: 'COMPLETED' })
  status!: string;

  @Column({ type: 'varchar', nullable: true })
  gatewayReference!: string | null;
}

/** Most specific active rule wins: PROVIDER > PROVIDER_TYPE > GLOBAL. */
@Entity('commission_rules')
@Check('commission_value_valid', `value >= 0 AND (type <> 'PERCENTAGE' OR value <= 100)`)
export class CommissionRule extends BaseEntityWithId {
  @Column({ type: 'enum', enum: CommissionScope, enumName: 'commission_scope' })
  scope!: CommissionScope;

  @Column({ type: 'enum', enum: ProviderType, enumName: 'provider_type', nullable: true })
  providerType!: ProviderType | null;

  @Uuid({ nullable: true })
  providerId!: string | null;

  @ManyToOne('Provider', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column({ type: 'enum', enum: DiscountType, enumName: 'discount_type' })
  type!: DiscountType;

  @Money()
  value!: number;

  @Column({ default: true })
  isActive!: boolean;
}

/** Commission snapshot per payment — rule changes never rewrite history. */
@Entity('commissions')
@Index(['providerId'])
export class Commission extends BaseEntityWithId {
  @Uuid({ unique: true })
  paymentId!: string;

  @OneToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Relation<Payment>;

  @Uuid({ nullable: true })
  ruleId!: string | null;

  @Money()
  grossAmount!: number;

  @Money()
  commissionAmount!: number;

  @Money()
  providerAmount!: number;

  @Uuid({ nullable: true })
  providerId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  entityType!: string | null;

  /** Commission given back on refunds (proportional). */
  @Money({ default: 0 })
  reversedCommission!: number;

  @Money({ default: 0 })
  reversedProviderAmount!: number;
}

@Entity('coupons')
export class Coupon extends BaseEntityWithId {
  @Column({ unique: true })
  code!: string;

  @Column({ type: 'enum', enum: DiscountType, enumName: 'discount_type' })
  type!: DiscountType;

  @Money()
  value!: number;

  @Money({ nullable: true })
  maxDiscount!: number | null;

  @Money({ nullable: true })
  minOrder!: number | null;

  @Column({ type: 'int', nullable: true })
  usageLimit!: number | null;

  @Column({ type: 'int', nullable: true })
  perUserLimit!: number | null;

  @Column({ type: 'int', default: 0 })
  usedCount!: number;

  @Uuid({ nullable: true })
  providerId!: string | null;

  @ManyToOne('Provider', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  /** APPOINTMENT / LAB / RADIOLOGY / PHARMACY / SUBSCRIPTION — null = any patient service */
  @Column({ type: 'varchar', nullable: true })
  serviceType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Tstz({ nullable: true })
  startsAt!: Date | null;

  @Tstz({ nullable: true })
  expiresAt!: Date | null;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('coupon_redemptions')
export class CouponRedemption extends BaseEntityWithId {
  @Uuid()
  couponId!: string;

  @ManyToOne(() => Coupon, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coupon_id' })
  coupon?: Relation<Coupon>;

  @Uuid({ nullable: true })
  patientId!: string | null;

  @ManyToOne('Patient', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  /** Subscription coupons are redeemed by a provider. */
  @Uuid({ nullable: true })
  providerId!: string | null;

  @Column()
  entityType!: string;

  @Uuid()
  entityId!: string;

  @Money()
  discount!: number;
}

/** A review must reference a completed interaction (enforced in the service + unique per appointment). */
@Entity('reviews')
@Index(['createdAt'])
@Check('review_rating_range', `rating BETWEEN 1 AND 5`)
@Index(['providerId', 'status'])
export class Review extends BaseEntityWithId {
  @Uuid()
  patientId!: string;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid()
  providerId!: string;

  @ManyToOne('Provider')
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid({ nullable: true, unique: true })
  appointmentId!: string | null;

  @OneToOne('Appointment', { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Relation<Appointment>;

  @Column({ default: 'APPOINTMENT' })
  entityType!: string;

  @Uuid({ nullable: true })
  entityId!: string | null;

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ type: 'enum', enum: ReviewStatus, enumName: 'review_status', default: ReviewStatus.PUBLISHED })
  status!: ReviewStatus;
}

@Entity('favorites')
export class Favorite {
  @PrimaryColumn('uuid')
  patientId!: string;

  @PrimaryColumn('uuid')
  providerId!: string;

  @ManyToOne('Patient', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @ManyToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Tstz({ default: () => 'now()' })
  createdAt!: Date;
}

// ───────────── Provider subscriptions (Phase 7) ─────────────

@Entity('subscription_plans')
@Check('subscription_plan_ck', `"price" >= 0 AND "duration_days" BETWEEN 1 AND 366`)
export class SubscriptionPlan extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  @Column({ type: 'enum', enum: ProviderType, enumName: 'provider_type' })
  providerType!: ProviderType;

  @Column()
  nameAr!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Price of one period. */
  @Money()
  price!: number;

  @Column({ type: 'int', default: 30 })
  durationDays!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  features!: string[];

  @Column({ default: false })
  isDefault!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

/** One row per provider: when the paid (or trial) period ends. Access = now < currentPeriodEnd + grace. */
@Entity('provider_subscriptions')
export class ProviderSubscription extends TimestampedEntity {
  @Uuid({ unique: true })
  providerId!: string;

  @OneToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid({ nullable: true })
  planId!: string | null;

  @ManyToOne(() => SubscriptionPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Relation<SubscriptionPlan>;

  /** TRIAL | ACTIVE | GRACE | EXPIRED (kept in sync by the job; access checks use the dates). */
  @Column({ type: 'varchar', length: 10, default: 'TRIAL' })
  status!: string;

  @Tstz({ nullable: true })
  trialEndsAt!: Date | null;

  @Tstz()
  currentPeriodEnd!: Date;

  @Tstz({ nullable: true })
  lastPaidAt!: Date | null;

  @Tstz({ nullable: true })
  reminderSentAt!: Date | null;

  @Tstz({ nullable: true })
  expiredNotifiedAt!: Date | null;
}

@Entity('subscription_invoices')
@Index(['providerId', 'createdAt'])
@Index(['status'])
@Check('subscription_invoice_ck', `"amount" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "periods" BETWEEN 1 AND 12`)
export class SubscriptionInvoice extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  @Uuid()
  providerId!: string;

  @ManyToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid({ nullable: true })
  planId!: string | null;

  @ManyToOne(() => SubscriptionPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan?: Relation<SubscriptionPlan>;

  /** Number of plan periods bought. */
  @Column({ type: 'int', default: 1 })
  periods!: number;

  @Money()
  amount!: number;

  @Money({ default: 0 })
  discount!: number;

  @Money()
  total!: number;

  @Uuid({ nullable: true })
  couponId!: string | null;

  /** PENDING (awaiting online payment) | AWAITING_REVIEW (transfer proof uploaded) | PAID | REJECTED | CANCELLED | FAILED */
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: string;

  /** ONLINE | INSTAPAY | VODAFONE_CASH | BANK_TRANSFER | CASH (recorded by admin) | FREE */
  @Column({ type: 'varchar', length: 16 })
  method!: string;

  @Uuid({ nullable: true })
  paymentId!: string | null;

  @Uuid({ nullable: true })
  proofFileId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  transferReference!: string | null;

  @Tstz({ nullable: true })
  periodStart!: Date | null;

  @Tstz({ nullable: true })
  periodEnd!: Date | null;

  @Uuid({ nullable: true })
  reviewedById!: string | null;

  @Column({ type: 'text', nullable: true })
  reviewNote!: string | null;

  @Tstz({ nullable: true })
  paidAt!: Date | null;

  @Uuid({ nullable: true })
  createdById!: string | null;
}

/** Money moved between the platform and a provider (pays out online collections / collects cash commission). */
@Entity('provider_settlements')
@Index(['providerId', 'createdAt'])
@Check('provider_settlement_ck', `"amount" > 0`)
export class ProviderSettlement extends BaseEntityWithId {
  @Uuid()
  providerId!: string;

  @ManyToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  /** TO_PROVIDER (platform paid the provider) | TO_PLATFORM (provider paid commission due) */
  @Column({ type: 'varchar', length: 12 })
  direction!: 'TO_PROVIDER' | 'TO_PLATFORM';

  @Money()
  amount!: number;

  @Column({ type: 'varchar', nullable: true })
  method!: string | null;

  @Column({ type: 'varchar', nullable: true })
  reference!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Uuid({ nullable: true })
  createdById!: string | null;
}
