import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, Relation } from 'typeorm';
import { BaseEntityWithId, TimestampedEntity, Tstz, Uuid } from './base';
import { Gender } from './enums';
import type { User } from './identity.entities';
import type { City, Area } from './location.entities';
import type { Provider } from './provider.entities';
import type { FileEntity } from './system.entities';

@Entity('patients')
export class Patient extends TimestampedEntity {
  @Uuid({ unique: true })
  userId!: string;

  @OneToOne('User', (u: User) => u.patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender', nullable: true })
  gender!: Gender | null;

  @Column({ type: 'varchar', nullable: true })
  address!: string | null;

  @Uuid({ nullable: true })
  cityId!: string | null;

  @ManyToOne('City', { nullable: true })
  @JoinColumn({ name: 'city_id' })
  city?: Relation<City>;

  @Uuid({ nullable: true })
  areaId!: string | null;

  @ManyToOne('Area', { nullable: true })
  @JoinColumn({ name: 'area_id' })
  area?: Relation<Area>;

  @Column({ type: 'varchar', nullable: true })
  bloodType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  emergencyContactName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  emergencyContactPhone!: string | null;

  @OneToOne('MedicalRecord', (m: MedicalRecord) => m.patient)
  medicalRecord?: Relation<MedicalRecord>;
}

/** Explicit consent: patient grants a provider access to their record. */
@Entity('patient_access_grants')
@Index(['patientId', 'providerId'])
export class PatientAccessGrant extends BaseEntityWithId {
  @Uuid()
  patientId!: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid()
  providerId!: string;

  @ManyToOne('Provider', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Tstz({ default: () => 'now()' })
  grantedAt!: Date;

  @Tstz({ nullable: true })
  expiresAt!: Date | null;

  @Tstz({ nullable: true })
  revokedAt!: Date | null;
}

@Entity('medical_records')
export class MedicalRecord extends TimestampedEntity {
  @Uuid({ unique: true })
  patientId!: string;

  @OneToOne(() => Patient, (p) => p.medicalRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => MedicalCondition, (c) => c.medicalRecord)
  conditions?: Relation<MedicalCondition[]>;

  @OneToMany(() => Allergy, (c) => c.medicalRecord)
  allergies?: Relation<Allergy[]>;

  @OneToMany(() => Medication, (c) => c.medicalRecord)
  medications?: Relation<Medication[]>;

  @OneToMany(() => Surgery, (c) => c.medicalRecord)
  surgeries?: Relation<Surgery[]>;
}

@Entity('medical_conditions')
export class MedicalCondition extends BaseEntityWithId {
  @Uuid()
  medicalRecordId!: string;

  @ManyToOne(() => MedicalRecord, (m) => m.conditions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medical_record_id' })
  medicalRecord?: Relation<MedicalRecord>;

  @Column()
  name!: string;

  @Column({ default: true })
  isChronic!: boolean;

  @Column({ type: 'date', nullable: true })
  diagnosedAt!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

@Entity('allergies')
export class Allergy extends BaseEntityWithId {
  @Uuid()
  medicalRecordId!: string;

  @ManyToOne(() => MedicalRecord, (m) => m.allergies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medical_record_id' })
  medicalRecord?: Relation<MedicalRecord>;

  @Column()
  allergen!: string;

  /** MILD / MODERATE / SEVERE */
  @Column({ type: 'varchar', nullable: true })
  severity!: string | null;

  @Column({ type: 'varchar', nullable: true })
  reaction!: string | null;
}

@Entity('medications')
export class Medication extends BaseEntityWithId {
  @Uuid()
  medicalRecordId!: string;

  @ManyToOne(() => MedicalRecord, (m) => m.medications, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medical_record_id' })
  medicalRecord?: Relation<MedicalRecord>;

  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  dosage!: string | null;

  @Column({ type: 'varchar', nullable: true })
  frequency!: string | null;

  @Column({ default: true })
  isCurrent!: boolean;

  @Column({ type: 'date', nullable: true })
  startedAt!: string | null;
}

@Entity('surgeries')
export class Surgery extends BaseEntityWithId {
  @Uuid()
  medicalRecordId!: string;

  @ManyToOne(() => MedicalRecord, (m) => m.surgeries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'medical_record_id' })
  medicalRecord?: Relation<MedicalRecord>;

  @Column()
  name!: string;

  @Column({ type: 'date', nullable: true })
  performedAt!: string | null;

  @Column({ type: 'varchar', nullable: true })
  hospital!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

@Entity('medical_documents')
@Index(['patientId'])
export class MedicalDocument extends BaseEntityWithId {
  @Uuid()
  patientId!: string;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient?: Relation<Patient>;

  @Uuid()
  fileId!: string;

  @ManyToOne('FileEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file?: Relation<FileEntity>;

  /** REPORT, PRESCRIPTION, REFERRAL, LAB, RADIOLOGY, OTHER */
  @Column()
  type!: string;

  @Column()
  title!: string;

  @Column({ type: 'date', nullable: true })
  documentDate!: string | null;
}
