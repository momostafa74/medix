import { CommissionScope, DiscountType, ProviderType } from '../../database/entities/enums';

export interface CommissionRuleLike {
  id?: string;
  scope: CommissionScope;
  providerType?: ProviderType | null;
  providerId?: string | null;
  type: DiscountType;
  value: number;
  isActive?: boolean;
}

/** Most specific active rule wins: PROVIDER > PROVIDER_TYPE > GLOBAL. */
export function pickRule(rules: CommissionRuleLike[], providerId: string, providerType: ProviderType) {
  const active = rules.filter((r) => r.isActive !== false);
  return (
    active.find((r) => r.scope === CommissionScope.PROVIDER && r.providerId === providerId) ??
    active.find((r) => r.scope === CommissionScope.PROVIDER_TYPE && r.providerType === providerType) ??
    active.find((r) => r.scope === CommissionScope.GLOBAL) ??
    null
  );
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** e.g. 500 EGP @ 10% → { commission: 50, provider: 450 }. Fixed commission is capped at the gross amount. */
export function calculateCommission(gross: number, rule: CommissionRuleLike | null) {
  if (!rule || gross <= 0) return { gross: round2(gross), commission: 0, provider: round2(gross), ruleId: rule?.id ?? null };
  const raw = rule.type === DiscountType.PERCENTAGE ? (gross * rule.value) / 100 : rule.value;
  const commission = round2(Math.min(Math.max(raw, 0), gross));
  return { gross: round2(gross), commission, provider: round2(gross - commission), ruleId: rule.id ?? null };
}
