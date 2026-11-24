import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth-user';
import { P } from '../permissions';

/**
 * Resource-level authorization ("may THIS user touch THIS record?").
 * Permissions say what kind of action is allowed; this service checks
 * ownership and provider↔patient relationships against the database.
 * IDs coming from the client are never trusted on their own.
 */
@Injectable()
export class AccessPolicyService {
  constructor(private ds: DataSource) {}

  /** A provider may see a patient's medical data only with a real care relationship. */
  async providerHasPatientRelationship(providerIds: string[], patientId: string): Promise<boolean> {
    if (!providerIds.length) return false;
    const [row] = await this.ds.query(
      `SELECT (
          EXISTS (SELECT 1 FROM appointments a
                   WHERE a.patient_id = $1 AND a.provider_id = ANY($2::uuid[])
                     AND a.status NOT IN ('CANCELLED'))
       OR EXISTS (SELECT 1 FROM lab_orders lo JOIN laboratories l ON l.id = lo.laboratory_id
                   WHERE lo.patient_id = $1 AND l.provider_id = ANY($2::uuid[])
                     AND lo.status <> 'CANCELLED')
       OR EXISTS (SELECT 1 FROM radiology_orders ro JOIN radiology_centers rc ON rc.id = ro.center_id
                   WHERE ro.patient_id = $1 AND rc.provider_id = ANY($2::uuid[])
                     AND ro.status NOT IN ('CANCELLED'))
       OR EXISTS (SELECT 1 FROM pharmacy_orders po JOIN pharmacies ph ON ph.id = po.pharmacy_id
                   WHERE po.patient_id = $1 AND ph.provider_id = ANY($2::uuid[])
                     AND po.status <> 'CANCELLED')
       OR EXISTS (SELECT 1 FROM patient_access_grants g
                   WHERE g.patient_id = $1 AND g.provider_id = ANY($2::uuid[])
                     AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()))
       ) AS ok`,
      [patientId, providerIds],
    );
    return !!row?.ok;
  }

  /** Medical record: the patient themself, or a provider with a care relationship. Admins are NOT included by design. */
  async assertCanReadMedicalRecord(user: AuthUser, patientId: string) {
    if (user.patientId === patientId) return;
    if (
      user.permissions.has(P.MEDICAL_RECORD_READ_PATIENT) &&
      (await this.providerHasPatientRelationship(user.providerIds, patientId))
    ) {
      return;
    }
    throw new ForbiddenException('لا تملك صلاحية الاطلاع على السجل الطبي لهذا المريض');
  }

  /** Basic (non-medical) patient profile. */
  async assertCanReadPatientProfile(user: AuthUser, patientId: string) {
    if (user.patientId === patientId) return;
    if (user.permissions.has(P.PATIENTS_READ_ANY)) return;
    if (await this.providerHasPatientRelationship(user.providerIds, patientId)) return;
    throw new ForbiddenException('لا تملك صلاحية الاطلاع على بيانات هذا المريض');
  }

  /** Provider management: owner / staff admin, or platform admin. */
  assertCanManageProvider(user: AuthUser, providerId: string) {
    if (user.adminProviderIds.includes(providerId) && user.permissions.has(P.PROVIDER_MANAGE_OWN)) return;
    if (user.permissions.has(P.PROVIDERS_MANAGE_ANY)) return;
    throw new ForbiddenException('لا تملك صلاحية إدارة هذا الحساب');
  }

  /**
   * Chat room access. Members: the subject user, the provider side (owner/staff),
   * and the platform team (CHAT_SUPPORT) for SUPPORT / ADMIN_PROVIDER rooms.
   * Patient↔provider conversations are private medical communication: the platform
   * team may open one ONLY after a participant reported it (moderation), and that
   * access is flagged so the caller can audit it.
   */
  chatAccess(
    user: AuthUser,
    room: { type: string; providerId: string | null; subjectUserId: string; reportedAt: Date | null },
  ): { member: boolean; moderator: boolean; side: 'SUBJECT' | 'PROVIDER' | 'PLATFORM' } {
    if (room.subjectUserId === user.id) return { member: true, moderator: false, side: room.type === 'ADMIN_PROVIDER' ? 'PROVIDER' : 'SUBJECT' };
    if (room.providerId && user.providerIds.includes(room.providerId)) return { member: true, moderator: false, side: 'PROVIDER' };
    if (user.permissions.has(P.CHAT_SUPPORT)) {
      if (room.type === 'SUPPORT' || room.type === 'ADMIN_PROVIDER') return { member: true, moderator: false, side: 'PLATFORM' };
      if (room.reportedAt) return { member: false, moderator: true, side: 'PLATFORM' };
    }
    throw new NotFoundException('المحادثة غير موجودة');
  }

  async doctorProviderId(doctorId: string): Promise<string> {
    const [row] = await this.ds.query(`SELECT provider_id FROM doctors WHERE id = $1`, [doctorId]);
    if (!row) throw new NotFoundException('الطبيب غير موجود');
    return row.provider_id;
  }
}

@Global()
@Module({ providers: [AccessPolicyService], exports: [AccessPolicyService] })
export class AccessModule {}
