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
  'connections:read',
  'connections:write',
  'ledger:read',
  'events:read',
  'compliance:write',
  'webhooks:manage',
] as const;

export type ApiScope = typeof API_SCOPES[number];

export function normalizeScopes(value: unknown): ApiScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = [...new Set(value.filter((scope): scope is ApiScope => typeof scope === 'string' && API_SCOPES.includes(scope as ApiScope)))].sort();
  return scopes.length === value.length ? scopes : null;
}
