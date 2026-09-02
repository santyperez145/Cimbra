export const SUPPORT_CATEGORIES = ['sandbox', 'api', 'console', 'compliance', 'commercial', 'other'] as const;
export type SupportCategory = typeof SUPPORT_CATEGORIES[number];

export const SUPPORT_STATUSES = ['open', 'pending_cimbra', 'pending_tenant', 'resolved', 'closed'] as const;
export type SupportStatus = typeof SUPPORT_STATUSES[number];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

export const ORGANIZATION_COUNTRIES = ['AR', 'MX', 'CO', 'BR', 'CL', 'PE'] as const;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function normalizeSupportCaseInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['category', 'subject', 'message'].includes(key))) return null;
  const category = isOneOf(body.category, SUPPORT_CATEGORIES) ? body.category : null;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!category || subject.length < 4 || subject.length > 140 || message.length < 8 || message.length > 4000) return null;
  return { category, subject, message };
}

export function normalizeSupportMessageInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = (value as Record<string, unknown>).body;
  if (typeof body !== 'string') return null;
  const normalized = body.trim();
  return normalized.length >= 3 && normalized.length <= 4000 ? { body: normalized } : null;
}

export function normalizeSupportStatusInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return isOneOf(status, SUPPORT_STATUSES) ? { status } : null;
}

export function normalizeOrganizationPatch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['name', 'country'].includes(key))) return null;
  const result: { name?: string; country?: typeof ORGANIZATION_COUNTRIES[number] } = {};
  if ('name' in body) {
    if (typeof body.name !== 'string') return null;
    const name = body.name.trim();
    if (name.length < 2 || name.length > 80) return null;
    result.name = name;
  }
  if ('country' in body) {
    if (!isOneOf(body.country, ORGANIZATION_COUNTRIES)) return null;
    result.country = body.country;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function normalizeLeadStatusInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return isOneOf(status, LEAD_STATUSES) ? { status } : null;
}

export function isClosedSupportStatus(status: SupportStatus) {
  return status === 'resolved' || status === 'closed';
}
