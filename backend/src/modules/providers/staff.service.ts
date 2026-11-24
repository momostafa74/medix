import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { Provider, ProviderBranch, ProviderStaff, ProviderType, Role, RoleCode, User, UserStatus } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { normalizePhone } from '../../common/utils/phone';
import { AccessPolicyService } from '../../common/access/access-policy.service';
import { AuditService } from '../audit/audit.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { CreateStaffDto, UpdateStaffDto } from './providers.dto';

/** Staff / manager role per provider type. Doctors do not have staff accounts in this release. */
const ROLES: Partial<Record<ProviderType, { staff: RoleCode; admin: RoleCode }>> = {
  [ProviderType.LABORATORY]: { staff: RoleCode.LAB_STAFF, admin: RoleCode.LAB_ADMIN },
  [ProviderType.RADIOLOGY]: { staff: RoleCode.RADIOLOGY_STAFF, admin: RoleCode.RADIOLOGY_ADMIN },
  [ProviderType.PHARMACY]: { staff: RoleCode.PHARMACY_STAFF, admin: RoleCode.PHARMACY_ADMIN },
};

/**
 * Team accounts of a lab / radiology center / pharmacy. The owner creates the
 * account (no linking of pre-existing accounts, so nobody can be pulled into a
 * provider without consent). Removing a member deactivates the link and
 * invalidates their sessions' cached permissions immediately.
 */
@Injectable()
export class ProviderStaffService {
  constructor(
    private ds: DataSource,
    private access: AccessPolicyService,
    private audit: AuditService,
    private loader: AuthUserLoader,
  ) {}

  private async provider(user: AuthUser, providerId: string) {
    this.access.assertCanManageProvider(user, providerId);
    const p = await this.ds.getRepository(Provider).findOneBy({ id: providerId });
    if (!p) throw new NotFoundException('مقدم الخدمة غير موجود');
    const roles = ROLES[p.type];
    if (!roles) throw new BadRequestException('هذا النوع من الحسابات لا يدعم إضافة موظفين');
    return { p, roles };
  }

  private async assertBranch(m: EntityManager, providerId: string, branchId?: string | null) {
    if (branchId && !(await m.exists(ProviderBranch, { where: { id: branchId, providerId } }))) throw new BadRequestException('الفرع غير موجود');
  }

  async list(user: AuthUser, providerId: string) {
    const { p } = await this.provider(user, providerId);
    const rows = await this.ds.query(
      `SELECT s.id, s.user_id, s.title, s.is_admin, s.is_active, s.branch_id, s.created_at, b.name AS branch_name,
              u.full_name, u.phone, u.email, u.status, u.last_login_at
         FROM provider_staff s JOIN users u ON u.id = s.user_id LEFT JOIN provider_branches b ON b.id = s.branch_id
        WHERE s.provider_id = $1 ORDER BY s.is_active DESC, s.created_at ASC`,
      [providerId],
    );
    const [owner] = await this.ds.query(`SELECT id, full_name, phone, email FROM users WHERE id = $1`, [p.ownerUserId]);
    return {
      owner: { userId: owner.id, fullName: owner.full_name, phone: owner.phone, email: owner.email },
      members: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        fullName: r.full_name,
        phone: r.phone,
        email: r.email,
        title: r.title,
        isAdmin: r.is_admin,
        isActive: r.is_active,
        accountStatus: r.status,
        branchId: r.branch_id,
        branchName: r.branch_name,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
      })),
    };
  }

  async create(user: AuthUser, providerId: string, dto: CreateStaffDto) {
    const { roles } = await this.provider(user, providerId);
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('رقم الهاتف غير صحيح');
    const email = dto.email?.toLowerCase() || null;
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const staff = await this.ds.transaction(async (m) => {
      if (await m.exists(User, { where: { phone } })) throw new ConflictException('رقم الهاتف مسجل بحساب آخر');
      if (email && (await m.exists(User, { where: { email } }))) throw new ConflictException('البريد الإلكتروني مسجل بحساب آخر');
      await this.assertBranch(m, providerId, dto.branchId);
      const role = await m.findOneByOrFail(Role, { code: dto.isAdmin ? roles.admin : roles.staff });
      const u = await m.save(m.create(User, { fullName: dto.fullName, phone, email, passwordHash, status: UserStatus.ACTIVE, roles: [role] }));
      const s = await m.save(m.create(ProviderStaff, { providerId, userId: u.id, branchId: dto.branchId ?? null, title: dto.title ?? null, isAdmin: !!dto.isAdmin, isActive: true }));
      await this.audit.log({ userId: user.id, action: 'PROVIDER_STAFF_ADDED', entity: 'provider_staff', entityId: s.id, newValue: { providerId, userId: u.id, isAdmin: !!dto.isAdmin, title: dto.title } }, m);
      return s;
    });
    return { id: staff.id };
  }

  async update(user: AuthUser, providerId: string, staffId: string, dto: UpdateStaffDto) {
    const { roles } = await this.provider(user, providerId);
    const s = await this.ds.transaction(async (m) => {
      const s = await m.findOne(ProviderStaff, { where: { id: staffId, providerId } });
      if (!s) throw new NotFoundException('الموظف غير موجود');
      if (s.userId === user.id && (dto.isActive === false || dto.isAdmin === false)) throw new BadRequestException('لا يمكنك إيقاف أو تقليل صلاحيات حسابك');
      await this.assertBranch(m, providerId, dto.branchId);
      const patch: Record<string, any> = {};
      if (dto.title !== undefined) patch.title = dto.title || null;
      if (dto.branchId !== undefined) patch.branchId = dto.branchId || null;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;
      if (dto.isAdmin !== undefined && dto.isAdmin !== s.isAdmin) {
        patch.isAdmin = dto.isAdmin;
        // Swap the provider role; other roles the user may hold are kept.
        const [from, to] = dto.isAdmin ? [roles.staff, roles.admin] : [roles.admin, roles.staff];
        await m.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE code = $2)`, [s.userId, from]);
        await m.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2 ON CONFLICT DO NOTHING`, [s.userId, to]);
      }
      if (Object.keys(patch).length) await m.update(ProviderStaff, s.id, patch);
      await this.audit.log({ userId: user.id, action: 'PROVIDER_STAFF_UPDATED', entity: 'provider_staff', entityId: s.id, oldValue: { isAdmin: s.isAdmin, isActive: s.isActive, title: s.title }, newValue: dto }, m);
      return s;
    });
    this.loader.invalidate(s.userId);
    return { ok: true };
  }
}
