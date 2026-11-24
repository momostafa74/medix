/** Files, chat, notifications, audit logs, settings. */
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation, UpdateDateColumn } from 'typeorm';
import { BaseEntityWithId, Tstz, Uuid } from './base';
import { ChatRoomType, FileVisibility, NotificationChannel, NotificationStatus } from './enums';
import type { User } from './identity.entities';

/** Metadata only — bytes live in the storage driver (local disk / S3 / Cloudinary). */
@Entity('files')
export class FileEntity extends BaseEntityWithId {
  @Column({ unique: true })
  storageKey!: string;

  @Column()
  driver!: string;

  @Column()
  originalName!: string;

  @Column()
  mimeType!: string;

  @Column({ type: 'int' })
  size!: number;

  @Column({ type: 'varchar', nullable: true })
  checksum!: string | null;

  @Column({ type: 'enum', enum: FileVisibility, enumName: 'file_visibility', default: FileVisibility.PRIVATE })
  visibility!: FileVisibility;

  /** Purpose tag drives authorization rules (AVATAR, PROVIDER_LOGO, PROVIDER_DOCUMENT, MEDICAL_DOCUMENT…). */
  @Column({ default: 'OTHER' })
  purpose!: string;

  @Uuid()
  uploadedById!: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy?: Relation<User>;
}

// ───────────── Chat (Phase 3) ─────────────

/**
 * One conversation. PATIENT_PROVIDER / ADMIN_PROVIDER rooms are unique per
 * (type, provider, subject user); SUPPORT rooms are unique per subject user.
 * The provider side is resolved dynamically (owner + active staff), so staff
 * changes never orphan a conversation.
 */
@Entity('chat_rooms')
@Index('chat_room_unique_provider', ['type', 'providerId', 'subjectUserId'], { unique: true, where: '"provider_id" IS NOT NULL' })
@Index('chat_room_unique_support', ['type', 'subjectUserId'], { unique: true, where: '"provider_id" IS NULL' })
@Index(['lastMessageAt'])
export class ChatRoom extends BaseEntityWithId {
  @Column({ type: 'enum', enum: ChatRoomType, enumName: 'chat_room_type' })
  type!: ChatRoomType;

  @Uuid({ nullable: true })
  providerId!: string | null;

  /** The non-provider party: the patient (PATIENT_PROVIDER), the admin who opened it (ADMIN_PROVIDER) or the requester (SUPPORT). */
  @Uuid()
  subjectUserId!: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_user_id' })
  subjectUser?: Relation<User>;

  @Uuid()
  createdById!: string;

  @Column({ default: false })
  isBlocked!: boolean;

  @Uuid({ nullable: true })
  blockedById!: string | null;

  @Tstz({ nullable: true })
  blockedAt!: Date | null;

  @Tstz({ nullable: true })
  reportedAt!: Date | null;

  @Uuid({ nullable: true })
  reportedById!: string | null;

  @Column({ type: 'text', nullable: true })
  reportReason!: string | null;

  @Tstz({ nullable: true })
  lastMessageAt!: Date | null;
}

@Entity('chat_participants')
export class ChatParticipant {
  @PrimaryColumn('uuid')
  roomId!: string;

  @PrimaryColumn('uuid')
  userId!: string;

  @ManyToOne(() => ChatRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room?: Relation<ChatRoom>;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Tstz({ nullable: true })
  lastReadAt!: Date | null;

  @Tstz({ default: () => 'now()' })
  joinedAt!: Date;
}

@Entity('chat_messages')
@Index(['roomId', 'createdAt'])
export class ChatMessage extends BaseEntityWithId {
  @Uuid()
  roomId!: string;

  @ManyToOne(() => ChatRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room?: Relation<ChatRoom>;

  @Uuid()
  senderId!: string;

  @ManyToOne('User')
  @JoinColumn({ name: 'sender_id' })
  sender?: Relation<User>;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Uuid({ nullable: true })
  fileId!: string | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'file_id' })
  file?: Relation<FileEntity>;
}

// ───────────── Notifications ─────────────

@Entity('notifications')
@Index(['userId', 'readAt'])
export class Notification extends BaseEntityWithId {
  @Uuid()
  userId!: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  /** APPOINTMENT_CONFIRMED, APPOINTMENT_CANCELLED, PROVIDER_APPROVED, … */
  @Column()
  type!: string;

  /** APPOINTMENTS, CHAT, LAB_RESULTS, PRESCRIPTIONS, PAYMENTS, SYSTEM, MARKETING */
  @Column({ default: 'SYSTEM' })
  category!: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
    default: NotificationChannel.IN_APP,
  })
  channel!: NotificationChannel;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    enumName: 'notification_status',
    default: NotificationStatus.SENT,
  })
  status!: NotificationStatus;

  @Tstz({ nullable: true })
  readAt!: Date | null;
}

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryColumn('uuid')
  userId!: string;

  @PrimaryColumn()
  category!: string;

  @PrimaryColumn({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
  channel!: NotificationChannel;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ default: true })
  enabled!: boolean;
}

// ───────────── Audit & settings ─────────────

@Entity('audit_logs')
@Index(['entity', 'entityId'])
@Index(['userId', 'createdAt'])
@Index(['createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog extends BaseEntityWithId {
  @Uuid({ nullable: true })
  userId!: string | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  /** e.g. PROVIDER_APPROVED, MEDICAL_RECORD_VIEWED, APPOINTMENT_CANCELLED */
  @Column()
  action!: string;

  @Column()
  entity!: string;

  @Column({ type: 'varchar', nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValue!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  newValue!: unknown;
}

@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn()
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @Uuid({ nullable: true })
  updatedById!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
