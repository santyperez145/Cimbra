export const API_SCOPES = [
  'customers:read',
  'customers:write',
  'accounts:read',
  'accounts:write',
  'cards:read',
  'cards:write',
  'transfers:read',
  'transfers:write',
  'payments:read',
  'payments:write',
  'billers:read',
  'billers:write',
  'risk:read',
  'risk:write',
  'disputes:read',
  'disputes:write',
  'reconciliation:read',
  'reconciliation:write',
  'settlements:read',
  'settlements:write',
  'approvals:read',
  'operations:read',
  'operations:write',
  'platform:read',
  'ledger:read',
  'events:read',
  'compliance:read',
  'compliance:write',
  'webhooks:manage',
] as const;

export type ApiScope = typeof API_SCOPES[number];

export function normalizeScopes(value: unknown): ApiScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = [...new Set(value.filter((scope): scope is ApiScope => typeof scope === 'string' && API_SCOPES.includes(scope as ApiScope)))].sort();
  return scopes.length === value.length ? scopes : null;
}
