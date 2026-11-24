import { Check, Column, Entity, Exclusion, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, Relation } from 'typeorm';
import { BaseEntityWithId, Money, TimestampedEntity, Tstz, Uuid } from './base';
import { AppointmentStatus, AppointmentType, PaymentMethod, PaymentStatus } from './enums';
import type { Patient } from './patient.entities';
import type { Provider, ProviderBranch } from './provider.entities';
import type { Doctor, Specialty } from './doctor.entities';
import type { User } from './identity.entities';

/**
 * Double booking is prevented at the DATABASE level by an exclusion constraint
 * (migration `AppointmentNoOverlap`): no two active appointments of the same
 * doctor may have overlapping [start_at, end_at). The booking service also takes
 * a per-doctor advisory lock inside a transaction for clean error messages.
 */
@Entity('appointments')
@Index(['createdAt'])
@Exclusion(
  'appointment_no_overlap',
  `USING gist (doctor_id WITH =, tstzrange(start_at, end_at, '[)'::text) WITH &&) WHERE (((doctor_id IS NOT NULL) AND (status = ANY (ARRAY['PENDING'::appointment_status, 'CONFIRMED'::appointment_status, 'CHECKED_IN'::appointment_status, 'IN_PROGRESS'::appointment_status, 'COMPLETED'::appointment_status]))))`,
)
@Check('appointment_time_order', `end_at > start_at`)
@Check('appointment_price_non_negative', `price >= 0 AND final_price >= 0 AND discount >= 0`)
@Index(['doctorId', 'startAt'])
@Index(['patientId', 'startAt'])
@Index(['providerId', 'startAt'])
@Index(['status'])
export class Appointment extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

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

  @Uuid({ nullable: true })
  doctorId!: string | null;

  @ManyToOne('Doctor', { nullable: true })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @Uuid({ nullable: true })
  specialtyId!: string | null;

  @ManyToOne('Specialty', { nullable: true })
  @JoinColumn({ name: 'specialty_id' })
  specialty?: Relation<Specialty>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne('ProviderBranch', { nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Tstz()
  startAt!: Date;

  @Tstz()
  endAt!: Date;

  @Column({ type: 'enum', enum: AppointmentType, enumName: 'appointment_type', default: AppointmentType.CLINIC })
  type!: AppointmentType;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
    default: AppointmentStatus.PENDING,
  })
  status!: AppointmentStatus;

  @Money()
  price!: number;

  @Money({ default: 0 })
  discount!: number;

  @Money()
  finalPrice!: number;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', default: PaymentStatus.PENDING })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method', default: PaymentMethod.CASH })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Private to the doctor/provider — never returned to the patient. */
  @Column({ type: 'text', nullable: true })
  doctorNotes!: string | null;

  @Column({ type: 'text', nullable: true })
  homeAddress!: string | null;

  @Column({ type: 'varchar', nullable: true })
  meetingUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Uuid({ nullable: true })
  cancelledById!: string | null;

  @ManyToOne('User', { nullable: true })
  @JoinColumn({ name: 'cancelled_by_id' })
  cancelledBy?: Relation<User>;

  @Tstz({ nullable: true })
  cancelledAt!: Date | null;

  @Uuid({ nullable: true, unique: true })
  rescheduledFromId!: string | null;

  @OneToOne(() => Appointment, { nullable: true })
  @JoinColumn({ name: 'rescheduled_from_id' })
  rescheduledFrom?: Relation<Appointment>;

  @Tstz({ nullable: true })
  checkedInAt!: Date | null;

  @Tstz({ nullable: true })
  completedAt!: Date | null;

  @Tstz({ nullable: true })
  reminderSentAt!: Date | null;

  @Uuid({ nullable: true })
  couponId!: string | null;

  @Uuid()
  createdById!: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<User>;

  @OneToMany(() => AppointmentStatusHistory, (h) => h.appointment)
  history?: Relation<AppointmentStatusHistory[]>;
}

@Entity('appointment_status_history')
@Index(['appointmentId'])
export class AppointmentStatusHistory extends BaseEntityWithId {
  @Uuid()
  appointmentId!: string;

  @ManyToOne(() => Appointment, (a) => a.history, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Relation<Appointment>;

  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status', nullable: true })
  fromStatus!: AppointmentStatus | null;

  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status' })
  toStatus!: AppointmentStatus;

  @Uuid()
  changedById!: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'changed_by_id' })
  changedBy?: Relation<User>;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
