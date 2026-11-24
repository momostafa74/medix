import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { BaseEntityWithId, TimestampedEntity, Tstz, Uuid } from './base';
import { TokenPurpose, UserStatus } from './enums';
import type { Patient } from './patient.entities';
import type { Doctor } from './doctor.entities';
import type { FileEntity } from './system.entities';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** e.g. `appointments.read.any`, `providers.approve` */
  @Column({ unique: true })
  code!: string;

  @Column()
  module!: string;

  @Column({ nullable: true })
  description?: string;
}

@Entity('roles')
export class Role extends BaseEntityWithId {
  @Column({ unique: true })
  code!: string;

  @Column()
  nameAr!: string;

  @Column()
  nameEn!: string;

  @Column({ default: true })
  isSystem!: boolean;

  @ManyToMany(() => Permission, { cascade: false })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions!: Relation<Permission[]>;
}

@Entity('users')
export class User extends TimestampedEntity {
  @Column({ type: 'varchar', unique: true, nullable: true })
  email!: string | null;

  @Column({ unique: true })
  phone!: string;

  @Column({ select: false })
  passwordHash!: string;

  @Column()
  fullName!: string;

  /** False for patients who signed up with phone + password only (name still a placeholder). */
  @Column({ default: true })
  profileCompleted!: boolean;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Column({ default: 'ar' })
  locale!: string;

  @Uuid({ nullable: true })
  avatarFileId!: string | null;

  @ManyToOne('FileEntity', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'avatar_file_id' })
  avatar?: Relation<FileEntity>;

  @Tstz({ nullable: true })
  emailVerifiedAt!: Date | null;

  @Tstz({ nullable: true })
  phoneVerifiedAt!: Date | null;

  @Tstz({ nullable: true })
  lastLoginAt!: Date | null;

  /** Bumped on password change / force logout → invalidates all access tokens. */
  @Column({ type: 'int', default: 0 })
  tokenVersion!: number;

  /** Consecutive wrong passwords; reset on success. */
  @Column({ type: 'int', default: 0 })
  failedLoginCount!: number;

  /** Login refused until this time after too many wrong passwords. */
  @Tstz({ nullable: true })
  lockedUntil!: Date | null;

  @Column({ default: false })
  twoFactorEnabled!: boolean;

  /** TOTP secret, AES-256-GCM encrypted (never selected by default). */
  @Column({ type: 'varchar', length: 200, nullable: true, select: false })
  twoFactorSecret!: string | null;

  /** SHA-256 hashes of unused one-time backup codes. */
  @Column({ type: 'jsonb', nullable: true, select: false })
  twoFactorBackupCodes!: string[] | null;

  /** Last accepted TOTP time-step — a code can be used only once. */
  @Column({ type: 'bigint', nullable: true, select: false })
  twoFactorLastStep!: string | null;

  @Tstz({ nullable: true })
  twoFactorEnabledAt!: Date | null;

  @ManyToMany(() => Role)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles!: Relation<Role[]>;

  @OneToOne('Patient', (p: Patient) => p.user)
  patient?: Relation<Patient>;

  @OneToOne('Doctor', (d: Doctor) => d.user)
  doctor?: Relation<Doctor>;
}

/**
 * One row per refresh token. Rotation revokes the row and issues a new one in
 * the same family; presenting an already-revoked token revokes the whole family.
 */
@Entity('sessions')
@Index(['userId', 'createdAt'])
@Index(['familyId'])
export class Session extends BaseEntityWithId {
  @Uuid()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Uuid()
  familyId!: string;

  @Column({ unique: true })
  tokenHash!: string;

  @Column({ type: 'varchar', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  @Tstz()
  expiresAt!: Date;

  @Tstz({ nullable: true })
  revokedAt!: Date | null;

  @Uuid({ nullable: true })
  replacedById!: string | null;

  @Tstz({ nullable: true })
  lastUsedAt!: Date | null;
}

@Entity('verification_tokens')
@Index(['userId', 'purpose'])
export class VerificationToken extends BaseEntityWithId {
  @Uuid()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ type: 'enum', enum: TokenPurpose, enumName: 'token_purpose' })
  purpose!: TokenPurpose;

  @Column({ unique: true })
  tokenHash!: string;

  @Tstz()
  expiresAt!: Date;

  @Tstz({ nullable: true })
  consumedAt!: Date | null;
}
