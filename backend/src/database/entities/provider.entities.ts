import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, Relation, Unique } from 'typeorm';
import { BaseEntityWithId, Money, TimestampedEntity, Tstz, Uuid, decimalTransformer } from './base';
import { ProviderType, VerificationStatus } from './enums';
import type { User } from './identity.entities';
import type { City, Area } from './location.entities';
import type { FileEntity } from './system.entities';
import type { Doctor } from './doctor.entities';

/** Structured weekly opening hours: day 0 = Sunday … 6 = Saturday, minutes from midnight (local time). */
export type OpeningHours = { day: number; open: number; close: number }[];

/**
 * Every public-facing healthcare entity is a Provider. Type-specific data lives
 * in Doctor / Laboratory / RadiologyCenter / Pharmacy (1:1 by provider_id).
 * Adding a new provider kind = new enum value (+ optional detail table).
 */
@Entity('providers')
@Index('providers_name_ar_trgm', { synchronize: false })
@Index('providers_name_en_trgm', { synchronize: false })
@Index('providers_subscription_ends_idx', { synchronize: false })
@Index(['type', 'verificationStatus', 'isActive'])
export class Provider extends TimestampedEntity {
  @Column({ type: 'enum', enum: ProviderType, enumName: 'provider_type' })
  type!: ProviderType;

  @Uuid()
  ownerUserId!: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'owner_user_id' })
  owner?: Relation<User>;

  @Column()
  nameAr!: string;

  @Column({ type: 'varchar', nullable: true })
  nameEn!: string | null;

  @Column({ unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Uuid({ nullable: true })
  logoFileId!: string | null;

  @ManyToOne('FileEntity', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'logo_file_id' })
  logo?: Relation<FileEntity>;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', nullable: true })
  whatsappNumber!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  website!: string | null;

  @Column({
    type: 'enum',
    enum: VerificationStatus,
    enumName: 'verification_status',
    default: VerificationStatus.PENDING,
  })
  verificationStatus!: VerificationStatus;

  @Column({ type: 'text', nullable: true })
  verificationNote!: string | null;

  @Tstz({ nullable: true })
  verifiedAt!: Date | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  homeServiceAvailable!: boolean;

  /** Denormalised from provider_subscriptions (kept in sync on payment and by the job) — public listings filter on it. */
  @Column({ default: true })
  subscriptionActive!: boolean;

  @Tstz({ nullable: true })
  subscriptionEndsAt!: Date | null;

  @Column({ type: 'numeric', precision: 3, scale: 2, default: 0, transformer: decimalTransformer })
  ratingAvg!: number;

  @Column({ type: 'int', default: 0 })
  ratingCount!: number;

  @OneToMany(() => ProviderBranch, (b) => b.provider)
  branches?: Relation<ProviderBranch[]>;

  @OneToMany(() => ProviderService, (s) => s.provider)
  services?: Relation<ProviderService[]>;

  @OneToMany(() => ProviderDocument, (d) => d.provider)
  documents?: Relation<ProviderDocument[]>;

  @OneToOne('Doctor', (d: Doctor) => d.provider)
  doctor?: Relation<Doctor>;
}

@Entity('provider_branches')
@Index(['providerId'])
@Index(['cityId', 'areaId'])
export class ProviderBranch extends TimestampedEntity {
  @Uuid()
  providerId!: string;

  @ManyToOne(() => Provider, (p) => p.branches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

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

  /** Ready for map integration later; nothing depends on a maps provider. */
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: decimalTransformer })
  latitude!: number | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: decimalTransformer })
  longitude!: number | null;

  /** Display hours (labs/pharmacies). Doctors' bookable hours live in doctor_schedules. */
  @Column({ type: 'jsonb', nullable: true })
  workingHours!: Record<string, unknown> | null;

  /** Structured hours used for bookable services (lab visits, later radiology/pharmacy pickup). */
  @Column({ type: 'jsonb', nullable: true })
  openingHours!: OpeningHours | null;

  @Column({ default: true })
  isActive!: boolean;
}

/** Links staff users (LAB_STAFF, PHARMACY_STAFF …) to a provider and optionally a branch. */
@Entity('provider_staff')
@Unique(['providerId', 'userId'])
export class ProviderStaff extends BaseEntityWithId {
  @Uuid()
  providerId!: string;

  @ManyToOne(() => Provider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid()
  userId!: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Uuid({ nullable: true })
  branchId!: string | null;

  @ManyToOne(() => ProviderBranch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Relation<ProviderBranch>;

  @Column({ type: 'varchar', nullable: true })
  title!: string | null;

  @Column({ default: false })
  isAdmin!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('provider_services')
@Index(['providerId'])
export class ProviderService extends BaseEntityWithId {
  @Uuid()
  providerId!: string;

  @ManyToOne(() => Provider, (p) => p.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Money()
  price!: number;

  @Column({ type: 'int', nullable: true })
  durationMinutes!: number | null;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('provider_documents')
export class ProviderDocument extends BaseEntityWithId {
  @Uuid()
  providerId!: string;

  @ManyToOne(() => Provider, (p) => p.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Uuid()
  fileId!: string;

  @ManyToOne('FileEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file?: Relation<FileEntity>;

  /** LICENSE, NATIONAL_ID, SYNDICATE_CARD, COMMERCIAL_REGISTER, OTHER */
  @Column()
  type!: string;

  @Tstz({ nullable: true })
  verifiedAt!: Date | null;

  @Uuid({ nullable: true })
  verifiedById!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}

/** Generic provider packages (labs have a richer lab_packages table). */
@Entity('service_packages')
export class ServicePackage extends BaseEntityWithId {
  @Uuid()
  providerId!: string;

  @ManyToOne(() => Provider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider?: Relation<Provider>;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Money()
  price!: number;

  @Column({ type: 'jsonb', nullable: true })
  items!: unknown;

  @Column({ default: true })
  isVisible!: boolean;
}
