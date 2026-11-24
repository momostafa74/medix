/** Shape of `req.user` after JWT validation — rebuilt from the DB, never trusted from the token payload. */
export interface AuthUser {
  id: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
  patientId: string | null;
  doctorId: string | null;
  /** Providers this user owns or is active staff of. */
  providerIds: string[];
  /** Providers where the user is owner or staff admin. */
  adminProviderIds: string[];
  /** Provider accounts only: monthly subscription state of their provider(s). */
  subscription?: { blocked: boolean; endsAt: Date | null; providerId: string | null };
  twoFactorEnabled?: boolean;
  /** Platform staff who must enrol in two-step verification before using anything else. */
  twoFactorSetupRequired?: boolean;
}

export const isAdminLike = (u: AuthUser) =>
  u.roles.includes('SUPER_ADMIN') || u.roles.includes('ADMIN') || u.roles.includes('SUPPORT');
