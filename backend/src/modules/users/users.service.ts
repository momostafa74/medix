import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { FileEntity, Permission, Role, RoleCode, Session, User, UserStatus } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { normalizePhone } from '../../common/utils/phone';
import { AuditService } from '../audit/audit.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { CreateStaffUserDto, ListUsersDto, UpdateMeDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    private ds: DataSource,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Role) private roles: Repository<Role>,
    @InjectRepository(Permission) private permissions: Repository<Permission>,
    private audit: AuditService,
    private loader: AuthUserLoader,
  ) {}

  async list(q: ListUsersDto) {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.roles', 'r')
      .orderBy('u.createdAt', 'DESC');
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      qb.andWhere('(u.fullName ILIKE :s OR u.phone ILIKE :s OR u.email ILIKE :s)', { s });
    }
    if (q.status) qb.andWhere('u.status = :st', { st: q.status });
    if (q.role) {
      qb.andWhere('u.id IN (SELECT ur.user_id FROM user_roles ur JOIN roles rr ON rr.id = ur.role_id WHERE rr.code = :role)', {
        role: q.role,
      });
    }
    const { skip, take } = skipTake(q);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(
      items.map((u) => ({ ...u, roles: u.roles.map((r) => r.code) })),
      total,
      q,
    );
  }

  async get(id: string) {
    const u = await this.users.findOne({ where: { id }, relations: { roles: true } });
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    return { ...u, roles: u.roles.map((r) => r.code) };
  }

  async setStatus(actor: AuthUser, id: string, status: UserStatus, reason?: string) {
    if (actor.id === id) throw new BadRequestException('لا يمكنك تغيير حالة حسابك');
    const u = await this.get(id);
    if (u.roles.includes(RoleCode.SUPER_ADMIN) && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
      throw new ForbiddenException('لا يمكن تعديل حساب مدير النظام الأعلى');
    }
    await this.ds.transaction(async (m) => {
      await m.update(User, { id }, { status });
      if (status !== UserStatus.ACTIVE) {
        await m.update(Session, { userId: id, revokedAt: IsNull() }, { revokedAt: new Date() });
        await m.increment(User, { id }, 'tokenVersion', 1);
      }
      await this.audit.log(
        { userId: actor.id, action: 'USER_STATUS_CHANGED', entity: 'users', entityId: id, oldValue: { status: u.status }, newValue: { status, reason } },
        m,
      );
    });
    this.loader.invalidate(id);
    return this.get(id);
  }

  async setRoles(actor: AuthUser, id: string, codes: RoleCode[]) {
    const u = await this.get(id);
    if (actor.id === id && u.roles.includes(RoleCode.SUPER_ADMIN) && !codes.includes(RoleCode.SUPER_ADMIN)) {
      throw new BadRequestException('لا يمكنك إزالة صلاحية مدير النظام الأعلى من نفسك');
    }
    if (codes.includes(RoleCode.SUPER_ADMIN) && !actor.roles.includes(RoleCode.SUPER_ADMIN)) {
      throw new ForbiddenException('فقط مدير النظام الأعلى يمكنه منح هذه الصلاحية');
    }
    const roles = await this.roles.find({ where: { code: In(codes) } });
    const user = await this.users.findOneOrFail({ where: { id }, relations: { roles: true } });
    user.roles = roles;
    await this.users.save(user);
    await this.users.increment({ id }, 'tokenVersion', 1);
    this.loader.invalidate(id);
    await this.audit.log({ userId: actor.id, action: 'USER_ROLES_CHANGED', entity: 'users', entityId: id, oldValue: u.roles, newValue: codes });
    return this.get(id);
  }

  async createStaff(actor: AuthUser, dto: CreateStaffUserDto) {
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('رقم الهاتف غير صحيح');
    const email = dto.email.toLowerCase();
    if (await this.users.exists({ where: [{ phone }, { email }] })) throw new ConflictException('المستخدم مسجل من قبل');
    const role = await this.roles.findOneByOrFail({ code: dto.role });
    const user = await this.users.save(
      this.users.create({ fullName: dto.fullName, phone, email, passwordHash: await bcrypt.hash(dto.password, 12), roles: [role] }),
    );
    await this.audit.log({ userId: actor.id, action: 'STAFF_USER_CREATED', entity: 'users', entityId: user.id, newValue: { role: dto.role } });
    return this.get(user.id);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const patch: Record<string, any> = {};
    if (dto.fullName) {
      patch.fullName = dto.fullName.trim();
      patch.profileCompleted = true;
    }
    if (dto.locale) patch.locale = dto.locale;
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase();
      const clash = await this.users.findOneBy({ email });
      if (clash && clash.id !== userId) throw new ConflictException('البريد الإلكتروني مسجل من قبل');
      const current = await this.users.findOneByOrFail({ id: userId });
      if (current.email !== email) {
        patch.email = email;
        patch.emailVerifiedAt = null;
      }
    }
    if (dto.avatarFileId !== undefined) {
      if (dto.avatarFileId) {
        // Only a file this user uploaded may become their avatar.
        const f = await this.ds.getRepository(FileEntity).findOneBy({ id: dto.avatarFileId, uploadedById: userId });
        if (!f || !f.mimeType.startsWith('image/')) throw new BadRequestException('الصورة غير صالحة');
      }
      patch.avatarFileId = dto.avatarFileId;
    }
    if (Object.keys(patch).length) await this.users.update(userId, patch);
    this.loader.invalidate(userId);
    return { ok: true };
  }

  // ─────────────── RBAC ───────────────

  listRoles() {
    return this.roles.find({ relations: { permissions: true }, order: { code: 'ASC' } });
  }

  listPermissions() {
    return this.permissions.find({ order: { module: 'ASC', code: 'ASC' } });
  }

  async setRolePermissions(actor: AuthUser, code: string, permissionCodes: string[]) {
    if (code === RoleCode.SUPER_ADMIN) throw new BadRequestException('صلاحيات مدير النظام الأعلى ثابتة');
    const role = await this.roles.findOne({ where: { code }, relations: { permissions: true } });
    if (!role) throw new NotFoundException('الدور غير موجود');
    const perms = await this.permissions.find({ where: { code: In(permissionCodes) } });
    const old = role.permissions.map((p) => p.code);
    role.permissions = perms;
    await this.roles.save(role);
    // Everyone with this role must pick up the change on the next request.
    const holders: { user_id: string }[] = await this.ds.query(`SELECT user_id FROM user_roles WHERE role_id = $1`, [role.id]);
    holders.forEach((h) => this.loader.invalidate(h.user_id));
    await this.audit.log({ userId: actor.id, action: 'ROLE_PERMISSIONS_CHANGED', entity: 'roles', entityId: role.id, oldValue: old, newValue: perms.map((p) => p.code) });
    return this.roles.findOne({ where: { id: role.id }, relations: { permissions: true } });
  }
}
