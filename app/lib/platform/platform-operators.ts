import { normalizeAccessEmail } from './access-policy.ts';

export const PLATFORM_OPERATOR_ROLES = ['owner', 'operator', 'viewer'] as const;
export type PlatformOperatorRole = typeof PLATFORM_OPERATOR_ROLES[number];

export function platformOperatorEmails() {
  return [...new Set((process.env.CIMBRA_PLATFORM_OPERATOR_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

export function isPlatformOperatorEmail(email: string) {
  const normalized = normalizeAccessEmail(email);
  return Boolean(normalized && platformOperatorEmails().includes(normalized));
}

export function canMutateAsPlatformOperator(role: PlatformOperatorRole) {
  return role === 'owner' || role === 'operator';
}

export function platformOperatorProvisioned() {
  return platformOperatorEmails().length > 0;
}
