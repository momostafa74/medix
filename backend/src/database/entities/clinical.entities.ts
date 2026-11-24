/**
 * Phase 4–6 clinical entities: prescriptions, laboratories, radiology, pharmacy,
 * home services. Tables exist from day one so later modules plug in without
 * schema redesign.
 */
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn, Relation, Unique } from 'typeorm';
import { BaseEntityWithId, Money, TimestampedEntity, Tstz, Uuid, decimalTransformer } from './base';
import {
  FulfillmentType,
  Gender,
  HomeServiceStatus,
  HomeServiceType,
  LabOrderStatus,
  PaymentMethod,
  PaymentStatus,
  PharmacyOrderStatus,
  RadiologyOrderStatus,
  ResultFlag,
} from './enums';
import type { Doctor } from './doctor.entities';
import type { FileEntity } from './system.entities';
import type { Patient } from './patient.entities';
import type { Appointment } from './appointment.entities';
import type { Provider, ProviderBranch, OpeningHours } from './provider.entities';

const Decimal14 = (opts: any = {}) =>
  Column({ type: 'numeric', precision: 14, scale: 4, nullable: true, transformer: decimalTransformer, ...opts });

// ───────────── Prescriptions ─────────────

@Entity('prescriptions')
@Index(['patientId'])
@Index(['doctorId'])
export class Prescription extends BaseEntityWithId {
  @Column({ unique: true })
  code!: string;

  /** Opaque code encoded in the QR; the public verify page shows authenticity only. */
  @Column({ unique: true })
  verificationCode!: string;

  @Uuid()
  doctorId!: string;

  @ManyToOne('Doctor')
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Relation<Doctor>;

  @Uuid()
  patientId!: string;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid({ nullable: true })
  appointmentId!: string | null;

  @ManyToOne('Appointment', { nullable: true })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Relation<Appointment>;

  @Column({ type: 'text', nullable: true })
  diagnosis!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Tstz({ default: () => 'now()' })
  issuedAt!: Date;

  /** After this date pharmacies should not dispense it. */
  @Column({ type: 'date', nullable: true })
  validUntil!: string | null;

  @Tstz({ nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  revokeReason!: string | null;

  /** Set once a pharmacy dispenses it — prevents the same prescription being filled twice. */
  @Tstz({ nullable: true })
  dispensedAt!: Date | null;

  @Uuid({ nullable: true })
  dispensedByProviderId!: string | null;

  @Uuid({ nullable: true })
  dispensedById!: string | null;

  @Uuid({ nullable: true })
  dispensedOrderId!: string | null;

  @Uuid({ nullable: true })
  pdfFileId!: string | null;

  @OneToMany(() => PrescriptionItem, (i) => i.prescription, { cascade: true })
  items?: Relation<PrescriptionItem[]>;
}

@Entity('prescription_items')
export class PrescriptionItem extends BaseEntityWithId {
  @Uuid()
  prescriptionId!: string;

  @ManyToOne(() => Prescription, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prescription_id' })
  prescription?: Relation<Prescription>;

  @Uuid({ nullable: true })
  medicineId!: string | null;

  @ManyToOne(() => Medicine, { nullable: true })
  @JoinColumn({ name: 'medicine_id' })
  medicine?: Relation<Medicine>;

  @Column()
  medicineName!: string;

  @Column()
  dose!: string;

  @Column()
  frequency!: string;

  @Column()
  duration!: string;

  /** Packs to dispense (optional). */
  @Column({ type: 'int', nullable: true })
  quantity!: number | null;

  @Column({ type: 'text', nullable: true })
  instructions!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

// ───────────── Laboratories ─────────────

@Entity('laboratories')
@Check('lab_booking_ck', `"slot_minutes" BETWEEN 5 AND 240 AND "slot_capacity" >= 1 AND "home_slot_capacity" >= 0 AND "booking_horizon_days" BETWEEN 1 AND 90`)
export class Laboratory extends BaseEntityWithId {
  @Uuid({ unique: true })
  providerId!: string;

  @OneToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column({ default: false })
  homeCollection!: boolean;

  @Money({ nullable: true })
  homeCollectionFee!: number | null;

  @Column({ type: 'varchar', nullable: true })
  accreditation!: string | null;

  /** Length of one in-branch booking window (minutes). */
  @Column({ type: 'int', default: 30 })
  slotMinutes!: number;

  /** Patients that can be booked into the same in-branch window. */
  @Column({ type: 'int', default: 4 })
  slotCapacity!: number;

  /** Home visits the lab can serve in the same hour. */
  @Column({ type: 'int', default: 2 })
  homeSlotCapacity!: number;

  @Column({ type: 'int', default: 14 })
  bookingHorizonDays!: number;

  /** Hours the home-collection team works: [{ day: 0-6 (Sun=0), open: minutes, close: minutes }]. */
  @Column({ type: 'jsonb', nullable: true })
  homeCollectionHours!: OpeningHours | null;

  /** Four-eyes rule: the approver must differ from the user who entered the results. */
  @Column({ default: false })
  requireSeparateApprover!: boolean;
}

@Entity('lab_test_categories')
export class LabTestCategory extends BaseEntityWithId {
  @Uuid()
  laboratoryId!: string;

  @ManyToOne(() => Laboratory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'laboratory_id' })
  laboratory?: Relation<Laboratory>;

  @Column()
  name!: string;
}

@Entity('lab_tests')
@Index('lab_tests_name_trgm', { synchronize: false })
@Unique(['laboratoryId', 'code'])
export class LabTest extends BaseEntityWithId {
  @Uuid()
  laboratoryId!: string;

  @ManyToOne(() => Laboratory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'laboratory_id' })
  laboratory?: Relation<Laboratory>;

  @Uuid({ nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => LabTestCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: Relation<LabTestCategory>;

  @Column()
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Money()
  price!: number;

  @Column({ type: 'varchar', nullable: true })
  sampleType!: string | null;

  @Column({ type: 'text', nullable: true })
  preparationInstructions!: string | null;

  @Column({ type: 'int', nullable: true })
  turnaroundHours!: number | null;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => LabTestParameter, (p) => p.test)
  parameters?: Relation<LabTestParameter[]>;
}

@Entity('lab_test_parameters')
export class LabTestParameter extends BaseEntityWithId {
  @Uuid()
  testId!: string;

  @ManyToOne(() => LabTest, (t) => t.parameters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_id' })
  test?: Relation<LabTest>;

  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  unit!: string | null;

  /** NUMERIC values are flagged automatically against ranges; TEXT values (e.g. "Negative") are flagged manually. */
  @Column({ type: 'varchar', length: 10, default: 'NUMERIC' })
  resultType!: 'NUMERIC' | 'TEXT';

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @OneToMany(() => LabTestRange, (r) => r.parameter)
  ranges?: Relation<LabTestRange[]>;
}

/** Normal ranges per parameter, optionally gender- and age-specific. */
@Entity('lab_test_ranges')
export class LabTestRange extends BaseEntityWithId {
  @Uuid()
  parameterId!: string;

  @ManyToOne(() => LabTestParameter, (p) => p.ranges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parameter_id' })
  parameter?: Relation<LabTestParameter>;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender', nullable: true })
  gender!: Gender | null;

  @Column({ type: 'int', nullable: true })
  ageMinYears!: number | null;

  @Column({ type: 'int', nullable: true })
  ageMaxYears!: number | null;

  @Decimal14()
  low!: number | null;

  @Decimal14()
  high!: number | null;

  @Decimal14()
  criticalLow!: number | null;

  @Decimal14()
  criticalHigh!: number | null;

  @Column({ type: 'varchar', nullable: true })
  textRange!: string | null;
}

@Entity('lab_packages')
export class LabPackage extends BaseEntityWithId {
  @Uuid()
  laboratoryId!: string;

  @ManyToOne(() => Laboratory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'laboratory_id' })
  laboratory?: Relation<Laboratory>;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Money()
  price!: number;

  @Column({ default: true })
  isActive!: boolean;

  /** Admin-controlled visibility. */
  @Column({ default: true })
  isVisible!: boolean;

  @OneToMany(() => LabPackageItem, (i) => i.package)
  items?: Relation<LabPackageItem[]>;
}

@Entity('lab_package_items')
export class LabPackageItem {
  @PrimaryColumn('uuid')
  packageId!: string;

  @PrimaryColumn('uuid')
  testId!: string;

  @ManyToOne(() => LabPackage, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'package_id' })
  package?: Relation<LabPackage>;

  @ManyToOne(() => LabTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_id' })
  test?: Relation<LabTest>;
}

@Entity('lab_orders')
@Index(['createdAt'])
@Index(['laboratoryId', 'status'])
@Index(['laboratoryId', 'scheduledAt'])
@Index(['patientId'])
@Check('lab_order_amounts_ck', `"subtotal" >= 0 AND "home_fee" >= 0 AND "discount" >= 0 AND "total" >= 0`)
export class LabOrder extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  @Uuid()
  laboratoryId!: string;

  @ManyToOne(() => Laboratory)
  @JoinColumn({ name: 'laboratory_id' })
  laboratory?: Relation<Laboratory>;

  @Uuid()
  patientId!: string;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne('ProviderBranch', { nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Tstz({ nullable: true })
  scheduledAt!: Date | null;

  @Column({ default: false })
  homeCollection!: boolean;

  @Column({ type: 'text', nullable: true })
  homeAddress!: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'enum', enum: LabOrderStatus, enumName: 'lab_order_status', default: LabOrderStatus.NEW_ORDER })
  status!: LabOrderStatus;

  @Money({ default: 0 })
  subtotal!: number;

  @Money({ default: 0 })
  homeFee!: number;

  @Money({ default: 0 })
  discount!: number;

  @Uuid({ nullable: true })
  couponId!: string | null;

  @Money()
  total!: number;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', default: PaymentStatus.PENDING })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Tstz({ nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Tstz({ nullable: true })
  cancelledAt!: Date | null;

  @Uuid({ nullable: true })
  cancelledById!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Tstz({ nullable: true })
  deliveredAt!: Date | null;

  @Uuid({ nullable: true })
  createdById!: string | null;

  @OneToMany(() => LabOrderItem, (i) => i.order)
  items?: Relation<LabOrderItem[]>;

  @OneToMany(() => LabSample, (x) => x.order)
  samples?: Relation<LabSample[]>;
}

@Entity('lab_order_status_history')
@Index(['orderId', 'createdAt'])
export class LabOrderStatusHistory extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => LabOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<LabOrder>;

  @Column({ type: 'enum', enum: LabOrderStatus, enumName: 'lab_order_status', nullable: true })
  fromStatus!: LabOrderStatus | null;

  @Column({ type: 'enum', enum: LabOrderStatus, enumName: 'lab_order_status' })
  toStatus!: LabOrderStatus;

  @Uuid({ nullable: true })
  changedById!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

@Entity('lab_order_items')
export class LabOrderItem extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => LabOrder, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<LabOrder>;

  @Uuid({ nullable: true })
  testId!: string | null;

  @ManyToOne(() => LabTest, { nullable: true })
  @JoinColumn({ name: 'test_id' })
  test?: Relation<LabTest>;

  @Uuid({ nullable: true })
  packageId!: string | null;

  @ManyToOne(() => LabPackage, { nullable: true })
  @JoinColumn({ name: 'package_id' })
  package?: Relation<LabPackage>;

  @Money()
  price!: number;
}

@Entity('lab_samples')
export class LabSample extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => LabOrder, (o) => o.samples, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<LabOrder>;

  @Column({ unique: true })
  barcode!: string;

  @Column()
  sampleType!: string;

  /** Test names drawn from this tube (label text). */
  @Column({ type: 'text', nullable: true })
  testsLabel!: string | null;

  @Tstz({ nullable: true })
  rejectedAt!: Date | null;

  @Uuid({ nullable: true })
  rejectedById!: string | null;

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;

  @Tstz({ nullable: true })
  collectedAt!: Date | null;

  @Uuid({ nullable: true })
  collectedById!: string | null;

  @Tstz({ nullable: true })
  receivedAt!: Date | null;
}

@Entity('lab_results')
export class LabResult extends BaseEntityWithId {
  @Uuid({ unique: true })
  orderId!: string;

  @ManyToOne(() => LabOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<LabOrder>;

  @Column({ unique: true })
  verificationCode!: string;

  @Uuid({ nullable: true })
  enteredById!: string | null;

  @Uuid({ nullable: true })
  reviewedById!: string | null;

  @Uuid({ nullable: true })
  approvedById!: string | null;

  @Tstz({ nullable: true })
  enteredAt!: Date | null;

  @Tstz({ nullable: true })
  reviewedAt!: Date | null;

  @Tstz({ nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Reviewer's note when results are sent back for correction. */
  @Column({ type: 'text', nullable: true })
  returnNote!: string | null;

  @Column({ type: 'int', default: 0 })
  criticalCount!: number;

  @Uuid({ nullable: true })
  pdfFileId!: string | null;

  @OneToMany(() => LabResultItem, (i) => i.result)
  items?: Relation<LabResultItem[]>;
}

@Entity('lab_result_items')
@Unique(['resultId', 'parameterId'])
export class LabResultItem extends BaseEntityWithId {
  @Uuid()
  resultId!: string;

  @ManyToOne(() => LabResult, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'result_id' })
  result?: Relation<LabResult>;

  @Uuid()
  parameterId!: string;

  @ManyToOne(() => LabTestParameter)
  @JoinColumn({ name: 'parameter_id' })
  parameter?: Relation<LabTestParameter>;

  @Uuid({ nullable: true })
  testId!: string | null;

  @Column()
  value!: string;

  @Decimal14()
  numericValue!: number | null;

  @Column({ type: 'varchar', nullable: true })
  unit!: string | null;

  @Column({ type: 'varchar', nullable: true })
  referenceRange!: string | null;

  @Column({ type: 'enum', enum: ResultFlag, enumName: 'result_flag', default: ResultFlag.NORMAL })
  flag!: ResultFlag;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

// ───────────── Radiology ─────────────

@Entity('radiology_centers')
export class RadiologyCenter extends BaseEntityWithId {
  @Uuid({ unique: true })
  providerId!: string;

  @OneToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  modalities!: string[];

  /** Booking grid step; exams start on multiples of this (their length comes from the service). */
  @Column({ type: 'int', default: 15 })
  slotStepMinutes!: number;

  @Column({ type: 'int', default: 30 })
  bookingHorizonDays!: number;

  /** Report must be approved by someone other than the radiologist who wrote it. */
  @Column({ default: false })
  requireSeparateApprover!: boolean;

  @Column({ type: 'varchar', nullable: true })
  accreditation!: string | null;
}

/** How many machines of a modality a branch runs — the booking capacity for overlapping exams. */
@Entity('radiology_branch_modalities')
@Unique(['branchId', 'modality'])
@Check('radiology_units_ck', `"units" BETWEEN 0 AND 50`)
export class RadiologyBranchModality extends BaseEntityWithId {
  @Uuid()
  centerId!: string;

  @ManyToOne(() => RadiologyCenter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'center_id' })
  center?: Relation<RadiologyCenter>;

  @Uuid()
  branchId!: string;

  @ManyToOne('ProviderBranch', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Column()
  modality!: string;

  @Column({ type: 'int', default: 1 })
  units!: number;
}

@Entity('radiology_services')
export class RadiologyService extends BaseEntityWithId {
  @Uuid()
  centerId!: string;

  @ManyToOne(() => RadiologyCenter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'center_id' })
  center?: Relation<RadiologyCenter>;

  /** XRAY, US, CT, MRI, MAMMO, … */
  @Column()
  modality!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Money()
  price!: number;

  @Column({ type: 'int', default: 30 })
  durationMinutes!: number;

  @Column({ type: 'text', nullable: true })
  preparationInstructions!: string | null;

  /** e.g. contrast CT / MRI usually need a doctor's referral. */
  @Column({ default: false })
  requiresReferral!: boolean;

  /** Default findings text the radiologist starts from. */
  @Column({ type: 'text', nullable: true })
  reportTemplate!: string | null;

  @Column({ type: 'int', nullable: true })
  turnaroundHours!: number | null;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('radiology_orders')
@Index(['createdAt'])
@Index(['centerId', 'status'])
@Index(['centerId', 'scheduledAt'])
@Index(['patientId'])
@Check('radiology_order_time_ck', `"end_at" > "scheduled_at"`)
export class RadiologyOrder extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  @Uuid()
  centerId!: string;

  @ManyToOne(() => RadiologyCenter)
  @JoinColumn({ name: 'center_id' })
  center?: Relation<RadiologyCenter>;

  @Uuid()
  serviceId!: string;

  @ManyToOne(() => RadiologyService)
  @JoinColumn({ name: 'service_id' })
  service?: Relation<RadiologyService>;

  @Uuid()
  patientId!: string;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne('ProviderBranch', { nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Tstz()
  scheduledAt!: Date;

  @Tstz()
  endAt!: Date;

  /** Snapshot of the service modality at booking (capacity is per branch + modality). */
  @Column()
  modality!: string;

  @Column({
    type: 'enum',
    enum: RadiologyOrderStatus,
    enumName: 'radiology_order_status',
    default: RadiologyOrderStatus.BOOKED,
  })
  status!: RadiologyOrderStatus;

  @Money()
  price!: number;

  /** Coupon discount; the patient pays price − discount. */
  @Money({ default: 0 })
  discount!: number;

  @Uuid({ nullable: true })
  couponId!: string | null;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', default: PaymentStatus.PENDING })
  paymentStatus!: PaymentStatus;

  @Uuid({ nullable: true })
  referralFileId!: string | null;

  /** Reason for the exam (patient complaint / referring doctor's request). */
  @Column({ type: 'text', nullable: true })
  clinicalIndication!: string | null;

  @Column({ type: 'varchar', nullable: true })
  referringDoctor!: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Tstz({ nullable: true })
  paidAt!: Date | null;

  @Tstz({ nullable: true })
  checkedInAt!: Date | null;

  @Tstz({ nullable: true })
  examStartedAt!: Date | null;

  @Tstz({ nullable: true })
  examCompletedAt!: Date | null;

  @Uuid({ nullable: true })
  technicianId!: string | null;

  @Tstz({ nullable: true })
  cancelledAt!: Date | null;

  @Uuid({ nullable: true })
  cancelledById!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Tstz({ nullable: true })
  deliveredAt!: Date | null;

  @Uuid({ nullable: true })
  createdById!: string | null;

  /** Future DICOM / PACS hooks. Accession number + Study Instance UID are issued at check-in. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  accessionNumber!: string | null;

  @Column({ type: 'varchar', nullable: true })
  studyInstanceUid!: string | null;

  @Column({ type: 'varchar', nullable: true })
  pacsUrl!: string | null;
}

@Entity('radiology_order_status_history')
@Index(['orderId', 'createdAt'])
export class RadiologyOrderStatusHistory extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => RadiologyOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<RadiologyOrder>;

  @Column({ type: 'enum', enum: RadiologyOrderStatus, enumName: 'radiology_order_status', nullable: true })
  fromStatus!: RadiologyOrderStatus | null;

  @Column({ type: 'enum', enum: RadiologyOrderStatus, enumName: 'radiology_order_status' })
  toStatus!: RadiologyOrderStatus;

  @Uuid({ nullable: true })
  changedById!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

/** Key images / scanned films / PDFs attached to an exam (DICOM stays in the future PACS). */
@Entity('radiology_order_files')
@Index(['orderId'])
export class RadiologyOrderFile extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => RadiologyOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<RadiologyOrder>;

  @Uuid()
  fileId!: string;

  @ManyToOne('FileEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file?: Relation<FileEntity>;

  @Column({ type: 'varchar', nullable: true })
  caption!: string | null;

  @Uuid({ nullable: true })
  uploadedById!: string | null;
}

@Entity('radiology_reports')
export class RadiologyReport extends BaseEntityWithId {
  @Uuid({ unique: true })
  orderId!: string;

  @OneToOne(() => RadiologyOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<RadiologyOrder>;

  @Column({ unique: true })
  verificationCode!: string;

  @Column({ type: 'text', nullable: true })
  technique!: string | null;

  @Column({ type: 'text', nullable: true })
  comparison!: string | null;

  @Column({ type: 'text' })
  findings!: string;

  @Column({ type: 'text' })
  impression!: string;

  @Column({ type: 'text', nullable: true })
  recommendations!: string | null;

  /** Urgent / critical finding — patient is alerted immediately on approval. */
  @Column({ default: false })
  critical!: boolean;

  @Tstz({ nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  returnNote!: string | null;

  @Uuid({ nullable: true })
  reportedById!: string | null;

  @Uuid({ nullable: true })
  approvedById!: string | null;

  @Tstz({ nullable: true })
  reportedAt!: Date | null;

  @Tstz({ nullable: true })
  approvedAt!: Date | null;

  @Uuid({ nullable: true })
  pdfFileId!: string | null;
}

// ───────────── Pharmacy ─────────────

@Entity('pharmacies')
export class Pharmacy extends BaseEntityWithId {
  @Uuid({ unique: true })
  providerId!: string;

  @OneToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column({ default: true })
  deliveryAvailable!: boolean;

  @Money({ nullable: true })
  deliveryFee!: number | null;

  @Column({ default: false })
  is24Hours!: boolean;

  /** Delivery is free when the subtotal reaches this amount (null = never free). */
  @Money({ nullable: true })
  freeDeliveryOver!: number | null;

  @Money({ default: 0 })
  minOrderForDelivery!: number;

  @Column({ type: 'int', default: 60 })
  estimatedDeliveryMinutes!: number;

  @Column({ type: 'varchar', nullable: true })
  deliveryAreasNote!: string | null;
}

/** Global medicine catalog shared by all pharmacies. */
@Entity('medicines')
@Index('medicines_name_en_trgm', { synchronize: false })
@Index('medicines_name_ar_trgm', { synchronize: false })
@Index(['nameEn'])
export class Medicine extends BaseEntityWithId {
  @Column({ type: 'varchar', nullable: true })
  nameAr!: string | null;

  @Column()
  nameEn!: string;

  @Column({ type: 'varchar', nullable: true })
  genericName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  form!: string | null;

  @Column({ type: 'varchar', nullable: true })
  strength!: string | null;

  @Column({ type: 'varchar', nullable: true })
  manufacturer!: string | null;

  @Column({ default: false })
  requiresPrescription!: boolean;

  /** MEDICINE or PRODUCT (cosmetics, supplements, devices…). */
  @Column({ type: 'varchar', length: 12, default: 'MEDICINE' })
  kind!: 'MEDICINE' | 'PRODUCT';

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', nullable: true })
  barcode!: string | null;

  /** Pharmacy that added it to the shared catalog (null = platform). */
  @Uuid({ nullable: true })
  createdByProviderId!: string | null;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('pharmacy_inventory')
@Unique(['pharmacyId', 'medicineId'])
@Check('pharmacy_inventory_ck', `"price" >= 0 AND ("quantity" IS NULL OR "quantity" >= 0)`)
export class PharmacyInventory extends TimestampedEntity {
  @Uuid()
  pharmacyId!: string;

  @ManyToOne(() => Pharmacy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pharmacy_id' })
  pharmacy?: Relation<Pharmacy>;

  @Uuid()
  medicineId!: string;

  @ManyToOne(() => Medicine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medicine_id' })
  medicine?: Relation<Medicine>;

  @Money()
  price!: number;

  @Column({ default: true })
  inStock!: boolean;

  @Column({ type: 'int', nullable: true })
  quantity!: number | null;
}

@Entity('pharmacy_orders')
@Index(['createdAt'])
@Index(['pharmacyId', 'status'])
@Index(['pharmacyId', 'createdAt'])
@Index(['patientId'])
@Check('pharmacy_order_amounts_ck', `"subtotal" >= 0 AND "delivery_fee" >= 0 AND "discount" >= 0 AND "total" >= 0`)
export class PharmacyOrder extends TimestampedEntity {
  @Column({ unique: true })
  code!: string;

  @Uuid()
  pharmacyId!: string;

  @ManyToOne(() => Pharmacy)
  @JoinColumn({ name: 'pharmacy_id' })
  pharmacy?: Relation<Pharmacy>;

  @Uuid()
  patientId!: string;

  @ManyToOne('Patient')
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne('ProviderBranch', { nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Uuid({ nullable: true })
  prescriptionId!: string | null;

  @ManyToOne(() => Prescription, { nullable: true })
  @JoinColumn({ name: 'prescription_id' })
  prescription?: Relation<Prescription>;

  @Uuid({ nullable: true })
  prescriptionFileId!: string | null;

  @Column({ type: 'enum', enum: FulfillmentType, enumName: 'fulfillment_type', default: FulfillmentType.PICKUP })
  fulfillment!: FulfillmentType;

  @Column({ type: 'text', nullable: true })
  deliveryAddress!: string | null;

  @Column({
    type: 'enum',
    enum: PharmacyOrderStatus,
    enumName: 'pharmacy_order_status',
    default: PharmacyOrderStatus.PENDING,
  })
  status!: PharmacyOrderStatus;

  @Money()
  subtotal!: number;

  @Money({ default: 0 })
  deliveryFee!: number;

  @Money({ default: 0 })
  discount!: number;

  @Uuid({ nullable: true })
  couponId!: string | null;

  @Money()
  total!: number;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status', default: PaymentStatus.PENDING })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method', nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Tstz({ nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone!: string | null;

  /** Pharmacist's message to the patient (substitutions, quote notes…). */
  @Column({ type: 'text', nullable: true })
  pharmacistNote!: string | null;

  /** Stock was taken from inventory (on confirmation) and must be returned on cancellation. */
  @Column({ default: false })
  stockReserved!: boolean;

  @Tstz({ nullable: true })
  confirmedAt!: Date | null;

  @Tstz({ nullable: true })
  readyAt!: Date | null;

  @Tstz({ nullable: true })
  outForDeliveryAt!: Date | null;

  @Tstz({ nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  driverName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  driverPhone!: string | null;

  @Tstz({ nullable: true })
  cancelledAt!: Date | null;

  @Uuid({ nullable: true })
  cancelledById!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Uuid({ nullable: true })
  createdById!: string | null;

  @OneToMany(() => PharmacyOrderItem, (i) => i.order)
  items?: Relation<PharmacyOrderItem[]>;
}

@Entity('pharmacy_order_status_history')
@Index(['orderId', 'createdAt'])
export class PharmacyOrderStatusHistory extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => PharmacyOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<PharmacyOrder>;

  @Column({ type: 'enum', enum: PharmacyOrderStatus, enumName: 'pharmacy_order_status', nullable: true })
  fromStatus!: PharmacyOrderStatus | null;

  @Column({ type: 'enum', enum: PharmacyOrderStatus, enumName: 'pharmacy_order_status' })
  toStatus!: PharmacyOrderStatus;

  @Uuid({ nullable: true })
  changedById!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

@Entity('pharmacy_order_items')
@Check('pharmacy_item_qty_ck', `"quantity" > 0 AND "unit_price" >= 0`)
export class PharmacyOrderItem extends BaseEntityWithId {
  @Uuid()
  orderId!: string;

  @ManyToOne(() => PharmacyOrder, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<PharmacyOrder>;

  @Uuid()
  medicineId!: string;

  /** Name snapshot at order time. */
  @Column({ type: 'varchar', nullable: true })
  medicineName!: string | null;

  @ManyToOne(() => Medicine)
  @JoinColumn({ name: 'medicine_id' })
  medicine?: Relation<Medicine>;

  @Column({ type: 'int' })
  quantity!: number;

  @Money()
  unitPrice!: number;
}

// ───────────── Home services ─────────────

@Entity('home_service_requests')
@Index(['providerId', 'status'])
export class HomeServiceRequest extends TimestampedEntity {
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

  @Column({ type: 'enum', enum: HomeServiceType, enumName: 'home_service_type' })
  type!: HomeServiceType;

  @Column({ type: 'text' })
  address!: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: decimalTransformer })
  latitude!: number | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: decimalTransformer })
  longitude!: number | null;

  @Tstz()
  preferredAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({
    type: 'enum',
    enum: HomeServiceStatus,
    enumName: 'home_service_status',
    default: HomeServiceStatus.REQUESTED,
  })
  status!: HomeServiceStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason!: string | null;
}
