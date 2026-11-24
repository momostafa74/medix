import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { ChatMessage, ChatParticipant, ChatRoom, ChatRoomType, FileEntity, Provider, VerificationStatus } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { MessagesQuery, OpenRoomDto, RoomsQuery, SendMessageDto } from './chat.dto';

type Side = 'A' | 'B' | 'MOD';
const TEAM_NAME = 'فريق ميديكس';

interface RoomCtx {
  room: ChatRoom;
  providerUserIds: string[];
  side: Side;
  moderator: boolean;
}

/**
 * Conversations between two parties:
 *  - PATIENT_PROVIDER: A = patient, B = provider (owner + active staff)
 *  - ADMIN_PROVIDER:   A = platform team, B = provider  (one shared room per provider)
 *  - SUPPORT:          A = requester,     B = platform team
 * Every action re-checks membership on the server; message bodies are never
 * readable by anyone outside the two parties (except moderators on reported rooms, audited).
 */
@Injectable()
export class ChatService implements OnModuleInit {
  private teamCache: { ids: string[]; at: number } | null = null;
  private rate = new Map<string, number[]>();

  constructor(
    private ds: DataSource,
    private access: AccessPolicyService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private gateway: NotificationsGateway,
  ) {}

  onModuleInit() {
    this.gateway.onPresence((userId, online) => {
      this.counterpartsOf(userId)
        .then((ids) => this.gateway.emitToUsers(ids, 'chat:presence', { userId, online }))
        .catch(() => undefined);
    });
  }

  // ─────────────── helpers ───────────────

  private async providerUserIds(providerId: string | null): Promise<string[]> {
    if (!providerId) return [];
    const rows: { id: string }[] = await this.ds.query(
      `SELECT owner_user_id AS id FROM providers WHERE id = $1
       UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active`,
      [providerId],
    );
    return rows.map((r) => r.id);
  }

  /** Users holding chat.support (the platform inbox). Cached briefly. */
  private async teamIds(): Promise<string[]> {
    if (this.teamCache && Date.now() - this.teamCache.at < 60_000) return this.teamCache.ids;
    const rows: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = $1 AND u.status = 'ACTIVE'`,
      [P.CHAT_SUPPORT],
    );
    this.teamCache = { ids: rows.map((r) => r.id), at: Date.now() };
    return this.teamCache.ids;
  }

  private sideOf(room: ChatRoom, userId: string, providerUserIds: string[], isTeam: boolean): Side {
    if (room.type === ChatRoomType.PATIENT_PROVIDER) {
      if (room.subjectUserId === userId) return 'A';
      if (providerUserIds.includes(userId)) return 'B';
      return 'MOD';
    }
    if (room.type === ChatRoomType.ADMIN_PROVIDER) {
      if (providerUserIds.includes(userId) || room.subjectUserId === userId) return 'B';
      return isTeam ? 'A' : 'MOD';
    }
    // SUPPORT
    if (room.subjectUserId === userId) return 'A';
    return 'B';
  }

  private async context(user: AuthUser, roomId: string): Promise<RoomCtx> {
    const room = await this.ds.getRepository(ChatRoom).findOneBy({ id: roomId });
    if (!room) throw new NotFoundException('المحادثة غير موجودة');
    const acc = this.access.chatAccess(user, room);
    const providerUserIds = await this.providerUserIds(room.providerId);
    const side = acc.moderator ? 'MOD' : this.sideOf(room, user.id, providerUserIds, user.permissions.has(P.CHAT_SUPPORT));
    return { room, providerUserIds, side, moderator: acc.moderator };
  }

  /** Everyone who should receive live events for this room. */
  private async recipients(room: ChatRoom, providerUserIds: string[]) {
    const ids = new Set<string>([room.subjectUserId, ...providerUserIds]);
    if (room.type !== ChatRoomType.PATIENT_PROVIDER) (await this.teamIds()).forEach((id) => ids.add(id));
    return [...ids];
  }

  /** Users who share a room with `userId` (for presence fan-out). */
  private async counterpartsOf(userId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `WITH my_rooms AS (
         SELECT r.id, r.provider_id, r.subject_user_id FROM chat_rooms r
          WHERE r.subject_user_id = $1
             OR r.provider_id IN (SELECT id FROM providers WHERE owner_user_id = $1
                                  UNION SELECT provider_id FROM provider_staff WHERE user_id = $1 AND is_active)
          LIMIT 500)
       SELECT subject_user_id AS id FROM my_rooms
       UNION SELECT p.owner_user_id FROM my_rooms m JOIN providers p ON p.id = m.provider_id
       UNION SELECT s.user_id FROM my_rooms m JOIN provider_staff s ON s.provider_id = m.provider_id AND s.is_active`,
      [userId],
    );
    return rows.map((r) => r.id).filter((id) => id !== userId);
  }

  private checkRate(userId: string) {
    const now = Date.now();
    const recent = (this.rate.get(userId) || []).filter((t) => now - t < 60_000);
    if (recent.length >= 40) throw new BadRequestException('رسائل كثيرة في وقت قصير، انتظر قليلاً');
    recent.push(now);
    this.rate.set(userId, recent);
    if (this.rate.size > 10_000) this.rate.clear();
  }

  // ─────────────── rooms ───────────────

  async open(user: AuthUser, dto: OpenRoomDto) {
    let providerId: string | null = null;
    let subjectUserId = user.id;

    if (dto.type === 'PATIENT_PROVIDER' && dto.patientId) {
      // Provider side reaching out to one of its own patients.
      const pid = dto.providerId ?? user.providerIds[0];
      if (!pid || !user.providerIds.includes(pid)) throw new ForbiddenException('غير مصرح');
      if (!(await this.access.providerHasPatientRelationship([pid], dto.patientId))) {
        throw new ForbiddenException('يمكنك مراسلة المرضى الذين حجزوا معك فقط');
      }
      const [row] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [dto.patientId]);
      if (!row) throw new NotFoundException('المريض غير موجود');
      providerId = pid;
      subjectUserId = row.user_id;
    } else if (dto.type === 'PATIENT_PROVIDER') {
      if (!user.patientId) throw new ForbiddenException('المراسلة مع مقدمي الخدمة متاحة لحسابات المرضى');
      if (!dto.providerId) throw new BadRequestException('حدد مقدم الخدمة');
      const p = await this.ds.getRepository(Provider).findOne({ where: { id: dto.providerId }, relations: { owner: true } });
      if (!p || p.verificationStatus !== VerificationStatus.APPROVED || !p.isActive || !p.subscriptionActive || p.owner?.status !== 'ACTIVE') {
        throw new NotFoundException('مقدم الخدمة غير متاح');
      }
      if (p.ownerUserId === user.id) throw new BadRequestException('لا يمكنك مراسلة نفسك');
      providerId = p.id;
    } else if (dto.type === 'ADMIN_PROVIDER') {
      if (!dto.providerId) throw new BadRequestException('حدد مقدم الخدمة');
      const isTeam = user.permissions.has(P.CHAT_SUPPORT);
      const isProviderSide = user.providerIds.includes(dto.providerId);
      if (!isTeam && !isProviderSide) throw new ForbiddenException('غير مصرح');
      const p = await this.ds.getRepository(Provider).findOneBy({ id: dto.providerId });
      if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
      providerId = p.id;
      subjectUserId = p.ownerUserId; // one shared room per provider
    } else {
      if (user.permissions.has(P.CHAT_SUPPORT)) throw new BadRequestException('أنت ضمن فريق الدعم بالفعل');
    }

    const repo = this.ds.getRepository(ChatRoom);
    let room = await repo.findOne({ where: providerId ? { type: dto.type as ChatRoomType, providerId, subjectUserId } : { type: dto.type as ChatRoomType, subjectUserId } });
    if (!room) {
      try {
        room = await repo.save(repo.create({ type: dto.type as ChatRoomType, providerId, subjectUserId, createdById: user.id }));
      } catch (e) {
        // Concurrent "open" — the unique index guarantees a single room; fetch the winner.
        if (!(e instanceof QueryFailedError)) throw e;
        room = await repo.findOneOrFail({ where: providerId ? { type: dto.type as ChatRoomType, providerId, subjectUserId } : { type: dto.type as ChatRoomType, subjectUserId } });
      }
    }
    if (dto.message?.trim()) await this.send(user, room.id, { body: dto.message });
    return this.getRoom(user, room.id);
  }

  async list(user: AuthUser, q: RoomsQuery) {
    const isTeam = user.permissions.has(P.CHAT_SUPPORT);
    const params: unknown[] = [user.id, user.providerIds.length ? user.providerIds : ['00000000-0000-0000-0000-000000000000']];
    // $1/$2 are always referenced (typed) so the count query and the page query share params.
    const typed = `$1::uuid IS NOT NULL AND cardinality($2::uuid[]) >= 0`;
    const visibility = q.reported
      ? isTeam
        ? `(r.reported_at IS NOT NULL AND ${typed})`
        : `(false AND ${typed})`
      : `(r.subject_user_id = $1 OR r.provider_id = ANY($2::uuid[]) ${isTeam ? `OR r.type IN ('SUPPORT','ADMIN_PROVIDER')` : ''})`;
    const filters: string[] = [visibility];
    if (q.type) {
      params.push(q.type);
      filters.push(`r.type = $${params.length}::chat_room_type`);
    }
    if (q.search) {
      params.push(`%${likeEscape(q.search)}%`);
      filters.push(`(pr.name_ar ILIKE $${params.length} OR su.full_name ILIKE $${params.length})`);
    }
    const { skip, take } = skipTake(q);
    const from = `FROM chat_rooms r
      LEFT JOIN providers pr ON pr.id = r.provider_id
      JOIN users su ON su.id = r.subject_user_id`;
    const where = `WHERE ${filters.join(' AND ')}`;
    const rows = await this.ds.query(
      `SELECT r.id, r.type, r.provider_id, r.subject_user_id, r.is_blocked, r.blocked_by_id, r.reported_at, r.last_message_at, r.created_at,
              pr.name_ar AS provider_name, pr.type AS provider_type, pr.logo_file_id, pr.slug AS provider_slug,
              su.full_name AS subject_name, su.avatar_file_id AS subject_avatar,
              lm.body AS last_body, lm.file_id AS last_file_id, lm.sender_id AS last_sender_id, lm.created_at AS last_at,
              (SELECT count(*)::int FROM chat_messages m
                 WHERE m.room_id = r.id AND m.sender_id <> $1
                   AND m.created_at > COALESCE((SELECT last_read_at FROM chat_participants cp WHERE cp.room_id = r.id AND cp.user_id = $1), 'epoch')) AS unread
         ${from}
         LEFT JOIN LATERAL (SELECT body, file_id, sender_id, created_at FROM chat_messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) lm ON true
         ${where}
        ORDER BY COALESCE(r.last_message_at, r.created_at) DESC
        OFFSET ${skip} LIMIT ${take}`,
      params,
    );
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${where}`, params);

    // Provider-side user ids for presence (batched)
    const provIds = [...new Set(rows.map((r: any) => r.provider_id).filter(Boolean))];
    const provUsers: { provider_id: string; user_id: string }[] = provIds.length
      ? await this.ds.query(
          `SELECT id AS provider_id, owner_user_id AS user_id FROM providers WHERE id = ANY($1::uuid[])
           UNION SELECT provider_id, user_id FROM provider_staff WHERE provider_id = ANY($1::uuid[]) AND is_active`,
          [provIds],
        )
      : [];
    const items = rows.map((r: any) => {
      const pUsers = provUsers.filter((x) => x.provider_id === r.provider_id).map((x) => x.user_id);
      const room = { type: r.type, subjectUserId: r.subject_user_id } as ChatRoom;
      const side = q.reported ? 'MOD' : this.sideOf(room, user.id, pUsers, isTeam);
      return this.presentRoom(r, side, pUsers);
    });
    return paginate(items, total, q);
  }

  private presentRoom(r: any, side: Side, providerUserIds: string[]) {
    let title: string;
    let avatarFileId: string | null = null;
    let counterpartIds: string[] = [];
    if (side === 'MOD') {
      title = `${r.subject_name} ↔ ${r.provider_name}`;
    } else if (r.type === 'PATIENT_PROVIDER') {
      if (side === 'A') {
        title = r.provider_name;
        avatarFileId = r.logo_file_id;
        counterpartIds = providerUserIds;
      } else {
        title = r.subject_name;
        avatarFileId = r.subject_avatar;
        counterpartIds = [r.subject_user_id];
      }
    } else if (r.type === 'ADMIN_PROVIDER') {
      title = side === 'B' ? 'إدارة ميديكس' : r.provider_name;
      if (side === 'A') counterpartIds = providerUserIds;
    } else {
      title = side === 'A' ? 'دعم ميديكس' : r.subject_name;
      if (side === 'B') {
        avatarFileId = r.subject_avatar;
        counterpartIds = [r.subject_user_id];
      }
    }
    return {
      id: r.id,
      type: r.type,
      side,
      title,
      subtitle: r.type === 'PATIENT_PROVIDER' && side === 'B' ? 'مريض' : r.type === 'SUPPORT' ? 'الدعم الفني' : r.type === 'ADMIN_PROVIDER' ? 'مقدم خدمة ↔ الإدارة' : r.provider_type,
      providerId: r.provider_id,
      providerSlug: r.provider_slug,
      avatarFileId,
      online: counterpartIds.some((id) => this.gateway.isOnline(id)),
      isBlocked: r.is_blocked,
      blockedById: r.blocked_by_id,
      reported: !!r.reported_at,
      unread: r.unread ?? 0,
      lastMessage: r.last_at
        ? { body: r.last_body, hasFile: !!r.last_file_id, senderId: r.last_sender_id, createdAt: r.last_at }
        : null,
      lastMessageAt: r.last_message_at,
      createdAt: r.created_at,
    };
  }

  async getRoom(user: AuthUser, roomId: string) {
    const ctx = await this.context(user, roomId);
    const [row] = await this.ds.query(
      `SELECT r.id, r.type, r.provider_id, r.subject_user_id, r.is_blocked, r.blocked_by_id, r.reported_at, r.last_message_at, r.created_at,
              pr.name_ar AS provider_name, pr.type AS provider_type, pr.logo_file_id, pr.slug AS provider_slug,
              su.full_name AS subject_name, su.avatar_file_id AS subject_avatar, 0 AS unread
         FROM chat_rooms r LEFT JOIN providers pr ON pr.id = r.provider_id JOIN users su ON su.id = r.subject_user_id
        WHERE r.id = $1`,
      [roomId],
    );
    const out = this.presentRoom(row, ctx.side, ctx.providerUserIds);
    return { ...out, canSend: !ctx.moderator && !ctx.room.isBlocked, canBlock: !ctx.moderator && ctx.room.type === 'PATIENT_PROVIDER', canUnblock: ctx.room.isBlocked && (ctx.room.blockedById === user.id || user.permissions.has(P.CHAT_SUPPORT)), moderator: ctx.moderator };
  }

  // ─────────────── messages ───────────────

  async messages(user: AuthUser, roomId: string, q: MessagesQuery, meta: { ip?: string; userAgent?: string | null } = {}) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator) {
      await this.audit.log({ userId: user.id, action: 'CHAT_REPORTED_VIEWED', entity: 'chat_rooms', entityId: roomId, ...meta });
    }
    const limit = q.limit ?? 30;
    const qb = this.ds
      .getRepository(ChatMessage)
      .createQueryBuilder('m')
      .leftJoin('m.sender', 's')
      .addSelect(['s.id', 's.fullName', 's.avatarFileId'])
      .leftJoinAndSelect('m.file', 'f')
      .where('m.roomId = :roomId', { roomId })
      .orderBy('m.createdAt', 'DESC')
      .take(limit + 1);
    if (q.before) qb.andWhere('m.createdAt < :before', { before: q.before });
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const team = ctx.room.type === ChatRoomType.PATIENT_PROVIDER ? [] : await this.teamIds();

    const participants = await this.ds.getRepository(ChatParticipant).find({ where: { roomId } });
    const otherReadAt = participants
      .filter((p) => p.userId !== user.id && this.sideOf(ctx.room, p.userId, ctx.providerUserIds, team.includes(p.userId)) !== ctx.side)
      .reduce<Date | null>((max, p) => (p.lastReadAt && (!max || p.lastReadAt > max) ? p.lastReadAt : max), null);

    return {
      items: rows
        .slice(0, limit)
        .reverse()
        .map((m) => this.presentMessage(m, ctx, team)),
      hasMore,
      otherReadAt,
    };
  }

  private presentMessage(m: ChatMessage, ctx: RoomCtx, team: string[]) {
    const side = this.sideOf(ctx.room, m.senderId, ctx.providerUserIds, team.includes(m.senderId));
    const isTeamSender = (ctx.room.type === 'SUPPORT' && side === 'B') || (ctx.room.type === 'ADMIN_PROVIDER' && side === 'A');
    return {
      id: m.id,
      roomId: m.roomId,
      body: m.body,
      createdAt: m.createdAt,
      sender: {
        id: m.senderId,
        side,
        name: isTeamSender ? `${TEAM_NAME} — ${(m.sender?.fullName || '').split(' ')[0]}` : m.sender?.fullName,
        avatarFileId: isTeamSender ? null : m.sender?.avatarFileId ?? null,
      },
      file: m.file ? { id: m.file.id, mimeType: m.file.mimeType, size: m.file.size, originalName: m.file.originalName } : null,
    };
  }

  async send(user: AuthUser, roomId: string, dto: SendMessageDto) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator) throw new ForbiddenException('لا يمكنك الإرسال في هذه المحادثة');
    if (ctx.room.isBlocked) throw new ForbiddenException({ message: 'هذه المحادثة محظورة', code: 'CHAT_BLOCKED' });
    const body = dto.body?.trim() || null;
    if (!body && !dto.fileId) throw new BadRequestException('الرسالة فارغة');
    this.checkRate(user.id);
    let file: FileEntity | null = null;
    if (dto.fileId) {
      file = await this.ds.getRepository(FileEntity).findOneBy({ id: dto.fileId, uploadedById: user.id, purpose: 'CHAT_ATTACHMENT' });
      if (!file) throw new BadRequestException('المرفق غير صالح');
      const used = await this.ds.getRepository(ChatMessage).exists({ where: { fileId: file.id } });
      if (used) throw new BadRequestException('هذا المرفق مُرسل بالفعل');
    }

    const saved = await this.ds.transaction(async (m) => {
      const msg = await m.save(m.create(ChatMessage, { roomId, senderId: user.id, body, fileId: file?.id ?? null }));
      await m.update(ChatRoom, { id: roomId }, { lastMessageAt: msg.createdAt });
      await m.upsert(ChatParticipant, { roomId, userId: user.id, lastReadAt: msg.createdAt }, ['roomId', 'userId']);
      return msg;
    });
    saved.sender = { id: user.id, fullName: user.fullName, avatarFileId: null } as any;
    saved.file = file ?? undefined;
    const team = ctx.room.type === ChatRoomType.PATIENT_PROVIDER ? [] : await this.teamIds();
    const payload = { ...this.presentMessage(saved, ctx, team), clientId: dto.clientId ?? null };
    const recipients = await this.recipients(ctx.room, ctx.providerUserIds);
    this.gateway.emitToUsers(recipients, 'chat:message', payload);

    // Offline recipients on the other side get ONE notification per unread burst.
    const others = recipients.filter(
      (id) => id !== user.id && this.sideOf(ctx.room, id, ctx.providerUserIds, team.includes(id)) !== ctx.side,
    );
    for (const id of others) {
      if (this.gateway.isOnline(id)) continue;
      const [{ unread }] = await this.ds.query(
        `SELECT count(*)::int AS unread FROM chat_messages m WHERE m.room_id = $1 AND m.sender_id <> $2
            AND m.created_at > COALESCE((SELECT last_read_at FROM chat_participants WHERE room_id = $1 AND user_id = $2), 'epoch')`,
        [roomId, id],
      );
      if (unread !== 1) continue;
      await this.notifications.notify(id, {
        type: 'CHAT_MESSAGE',
        category: 'CHAT',
        title: `رسالة جديدة من ${payload.sender.name}`,
        body: body ? body.slice(0, 120) : 'مرفق',
        data: { roomId },
      });
    }
    return payload;
  }

  async markRead(user: AuthUser, roomId: string) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator) return { ok: true };
    const at = new Date();
    await this.ds.getRepository(ChatParticipant).upsert({ roomId, userId: user.id, lastReadAt: at }, ['roomId', 'userId']);
    const recipients = await this.recipients(ctx.room, ctx.providerUserIds);
    this.gateway.emitToUsers(recipients, 'chat:read', { roomId, userId: user.id, side: ctx.side, at });
    return { ok: true, at };
  }

  async typing(user: AuthUser, roomId: string) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator || ctx.room.isBlocked) return;
    const recipients = (await this.recipients(ctx.room, ctx.providerUserIds)).filter((id) => id !== user.id);
    this.gateway.emitToUsers(recipients, 'chat:typing', { roomId, userId: user.id, side: ctx.side });
  }

  async unreadTotal(user: AuthUser) {
    const isTeam = user.permissions.has(P.CHAT_SUPPORT);
    const [{ count }] = await this.ds.query(
      `SELECT count(*)::int AS count FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
        WHERE (r.subject_user_id = $1 OR r.provider_id = ANY($2::uuid[]) ${isTeam ? `OR r.type IN ('SUPPORT','ADMIN_PROVIDER')` : ''})
          AND m.sender_id <> $1
          AND m.created_at > COALESCE((SELECT last_read_at FROM chat_participants cp WHERE cp.room_id = r.id AND cp.user_id = $1), 'epoch')`,
      [user.id, user.providerIds.length ? user.providerIds : ['00000000-0000-0000-0000-000000000000']],
    );
    return { count };
  }

  // ─────────────── moderation ───────────────

  async block(user: AuthUser, roomId: string, meta: { ip?: string; userAgent?: string | null } = {}) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator || ctx.room.type !== ChatRoomType.PATIENT_PROVIDER) throw new ForbiddenException('لا يمكن حظر هذه المحادثة');
    if (ctx.room.isBlocked) return this.getRoom(user, roomId);
    await this.ds.getRepository(ChatRoom).update(roomId, { isBlocked: true, blockedById: user.id, blockedAt: new Date() });
    await this.audit.log({ userId: user.id, action: 'CHAT_BLOCKED', entity: 'chat_rooms', entityId: roomId, ...meta });
    this.gateway.emitToUsers(await this.recipients(ctx.room, ctx.providerUserIds), 'chat:room', { roomId, isBlocked: true });
    return this.getRoom(user, roomId);
  }

  async unblock(user: AuthUser, roomId: string, meta: { ip?: string; userAgent?: string | null } = {}) {
    const ctx = await this.context(user, roomId);
    if (!ctx.room.isBlocked) return this.getRoom(user, roomId);
    if (ctx.room.blockedById !== user.id && !user.permissions.has(P.CHAT_SUPPORT)) {
      throw new ForbiddenException('فقط من قام بالحظر يمكنه إلغاؤه');
    }
    await this.ds.getRepository(ChatRoom).update(roomId, { isBlocked: false, blockedById: null, blockedAt: null });
    await this.audit.log({ userId: user.id, action: 'CHAT_UNBLOCKED', entity: 'chat_rooms', entityId: roomId, ...meta });
    this.gateway.emitToUsers(await this.recipients(ctx.room, ctx.providerUserIds), 'chat:room', { roomId, isBlocked: false });
    return this.getRoom(user, roomId);
  }

  async report(user: AuthUser, roomId: string, reason: string, meta: { ip?: string; userAgent?: string | null } = {}) {
    const ctx = await this.context(user, roomId);
    if (ctx.moderator) throw new ForbiddenException('غير مصرح');
    await this.ds.getRepository(ChatRoom).update(roomId, { reportedAt: new Date(), reportedById: user.id, reportReason: reason });
    await this.audit.log({ userId: user.id, action: 'CHAT_REPORTED', entity: 'chat_rooms', entityId: roomId, newValue: { reason }, ...meta });
    await this.notifications.notifyMany(await this.teamIds(), {
      type: 'CHAT_REPORTED',
      category: 'SYSTEM',
      title: 'بلاغ عن محادثة',
      body: `قام ${user.fullName} بالإبلاغ عن محادثة: ${reason.slice(0, 120)}`,
      data: { roomId },
      force: true,
    });
    return { ok: true };
  }

  async dismissReport(user: AuthUser, roomId: string) {
    if (!user.permissions.has(P.CHAT_SUPPORT)) throw new ForbiddenException('غير مصرح');
    const room = await this.ds.getRepository(ChatRoom).findOneBy({ id: roomId });
    if (!room?.reportedAt) throw new NotFoundException('لا يوجد بلاغ');
    await this.ds.getRepository(ChatRoom).update(roomId, { reportedAt: null, reportedById: null, reportReason: null });
    await this.audit.log({ userId: user.id, action: 'CHAT_REPORT_DISMISSED', entity: 'chat_rooms', entityId: roomId });
    return { ok: true };
  }

  /** Used by the files module: may this user read an attachment sent in a chat? */
  async canReadAttachment(user: AuthUser, fileId: string) {
    const msg = await this.ds.getRepository(ChatMessage).findOneBy({ fileId });
    if (!msg) return false;
    try {
      await this.context(user, msg.roomId);
      return true;
    } catch {
      return false;
    }
  }
}
