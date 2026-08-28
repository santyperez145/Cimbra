export const API_SCOPES = [
  'customers:write',
  'accounts:write',
  'cards:write',
  'transfers:write',
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
