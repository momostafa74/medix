import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn, PrimaryGeneratedColumn, Relation, Unique } from 'typeorm';
import { BaseEntityWithId, Money, TimestampedEntity, Tstz, Uuid } from './base';
import { AppointmentType, Gender, ScheduleExceptionType } from './enums';
import type { User } from './identity.entities';
import type { Provider, ProviderBranch } from './provider.entities';
import type { FileEntity } from './system.entities';

@Entity('specialties')
@Index('specialties_name_ar_trgm', { synchronize: false })
export class Specialty extends TimestampedEntity {
  /** Set for sub-specialties. */
  @Uuid({ nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Specialty, (s) => s.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: Relation<Specialty>;

  @OneToMany(() => Specialty, (s) => s.parent)
  children?: Relation<Specialty[]>;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Uuid({ nullable: true })
  imageFileId!: string | null;

  @ManyToOne('FileEntity', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'image_file_id' })
  image?: Relation<FileEntity>;

  @Column({ type: 'varchar', nullable: true })
  icon!: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

@Entity('doctors')
@Check('doctor_price_non_negative', `consultation_price >= 0`)
@Index(['consultationPrice'])
export class Doctor extends TimestampedEntity {
  @Uuid({ unique: true })
  userId!: string;

  @OneToOne('User', (u: User) => u.doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Uuid({ unique: true })
  providerId!: string;

  @OneToOne('Provider', (p: Provider) => p.doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  /** د. / أ.د. / استشاري … */
  @Column({ type: 'varchar', nullable: true })
  title!: string | null;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender', nullable: true })
  gender!: Gender | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'text', nullable: true })
  qualifications!: string | null;

  @Column({ type: 'varchar', nullable: true })
  licenseNumber!: string | null;

  @Column({ type: 'varchar', nullable: true })
  licenseAuthority!: string | null;

  @Column({ type: 'int', default: 0 })
  experienceYears!: number;

  @Money()
  consultationPrice!: number;

  @Money({ nullable: true })
  onlinePrice!: number | null;

  @Money({ nullable: true })
  homeVisitPrice!: number | null;

  @Column({ default: false })
  onlineAvailable!: boolean;

  @Column({ default: false })
  homeVisitAvailable!: boolean;

  @Column({ type: 'text', array: true, default: () => "'{ar}'" })
  languages!: string[];

  /** true → new bookings are CONFIRMED immediately; false → PENDING until the doctor confirms. */
  @Column({ default: true })
  autoConfirm!: boolean;

  /** Minimum hours before start that a patient may still cancel/reschedule. */
  @Column({ type: 'int', default: 2 })
  cancellationWindowHours!: number;

  /** How many days ahead patients can book. */
  @Column({ type: 'int', default: 30 })
  bookingHorizonDays!: number;

  @OneToMany(() => DoctorSpecialty, (s) => s.doctor)
  specialties?: Relation<DoctorSpecialty[]>;

  @OneToMany(() => DoctorSchedule, (s) => s.doctor)
  schedules?: Relation<DoctorSchedule[]>;
}

@Entity('doctor_specialties')
@Index('doctor_one_primary_specialty', { synchronize: false })
@Index(['specialtyId'])
export class DoctorSpecialty {
  @PrimaryColumn('uuid')
  doctorId!: string;

  @PrimaryColumn('uuid')
  specialtyId!: string;

  @ManyToOne(() => Doctor, (d) => d.specialties, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @ManyToOne(() => Specialty, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'specialty_id' })
  specialty?: Relation<Specialty>;

  @Column({ default: false })
  isPrimary!: boolean;
}

/**
 * Weekly recurring working block. Minutes are minutes-from-midnight in the
 * platform timezone (APP_TIMEZONE, Africa/Cairo by default).
 */
@Entity('doctor_schedules')
@Check(
  'doctor_schedule_valid',
  `day_of_week BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute AND slot_duration BETWEEN 5 AND 240`,
)
@Index(['doctorId', 'dayOfWeek'])
export class DoctorSchedule extends TimestampedEntity {
  @Uuid()
  doctorId!: string;

  @ManyToOne(() => Doctor, (d) => d.schedules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne('ProviderBranch', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  /** 0 = Sunday … 6 = Saturday */
  @Column({ type: 'smallint' })
  dayOfWeek!: number;

  @Column({ type: 'int' })
  startMinute!: number;

  @Column({ type: 'int' })
  endMinute!: number;

  @Column({ type: 'int' })
  slotDuration!: number;

  @Column({
    type: 'enum',
    enum: AppointmentType,
    enumName: 'appointment_type',
    default: AppointmentType.CLINIC,
  })
  appointmentType!: AppointmentType;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => DoctorScheduleBreak, (b) => b.schedule, { cascade: true })
  breaks?: Relation<DoctorScheduleBreak[]>;
}

@Entity('doctor_schedule_breaks')
@Check('doctor_break_valid', `end_minute > start_minute`)
export class DoctorScheduleBreak {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Uuid()
  scheduleId!: string;

  @ManyToOne(() => DoctorSchedule, (s) => s.breaks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule?: Relation<DoctorSchedule>;

  @Column({ type: 'int' })
  startMinute!: number;

  @Column({ type: 'int' })
  endMinute!: number;

  @Column({ type: 'varchar', nullable: true })
  label!: string | null;
}

/** HOLIDAY / VACATION remove whole days; CUSTOM_HOURS replaces weekly hours for those dates. */
@Entity('doctor_schedule_exceptions')
@Check('doctor_exception_valid', `end_date >= start_date`)
@Index(['doctorId', 'startDate', 'endDate'])
export class DoctorScheduleException extends BaseEntityWithId {
  @Uuid()
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @Column({ type: 'enum', enum: ScheduleExceptionType, enumName: 'schedule_exception_type' })
  type!: ScheduleExceptionType;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'int', nullable: true })
  startMinute!: number | null;

  @Column({ type: 'int', nullable: true })
  endMinute!: number | null;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @Column({ type: 'int', nullable: true })
  slotDuration!: number | null;

  @Column({ type: 'varchar', nullable: true })
  reason!: string | null;
}

/** Individually blocked slots (doctor closes one slot without a booking). */
@Entity('doctor_slots')
@Unique(['doctorId', 'startAt'])
export class DoctorSlot extends BaseEntityWithId {
  @Uuid()
  doctorId!: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @Tstz()
  startAt!: Date;

  @Tstz()
  endAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  reason!: string | null;
}
