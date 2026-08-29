import type { WorkItemPriority } from '@/db/operations';

export type WorkItemUpdate = {
  assignedToUserId?: string | null;
  priority?: WorkItemPriority;
  dueAt?: string | null;
  escalated?: boolean;
};

export function normalizeWorkItemUpdate(value: unknown): WorkItemUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowed = new Set(['assignedToUserId', 'priority', 'dueAt', 'escalated']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const result: WorkItemUpdate = {};
  if ('assignedToUserId' in body) {
    if (body.assignedToUserId !== null && (typeof body.assignedToUserId !== 'string' || body.assignedToUserId.trim().length < 8)) return null;
    result.assignedToUserId = typeof body.assignedToUserId === 'string' ? body.assignedToUserId.trim() : null;
  }
  if ('priority' in body) {
    if (!['low', 'medium', 'high', 'critical'].includes(String(body.priority))) return null;
    result.priority = body.priority as WorkItemPriority;
  }
  if ('dueAt' in body) {
    if (body.dueAt !== null && (typeof body.dueAt !== 'string' || !Number.isFinite(Date.parse(body.dueAt)))) return null;
    result.dueAt = typeof body.dueAt === 'string' ? new Date(body.dueAt).toISOString() : null;
  }
  if ('escalated' in body) {
    if (typeof body.escalated !== 'boolean') return null;
    result.escalated = body.escalated;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function normalizeOperationalNote(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = (value as Record<string, unknown>).body;
  if (typeof body !== 'string') return null;
  const normalized = body.trim();
  return normalized.length >= 3 && normalized.length <= 2000 ? normalized : null;
}

export function normalizeEvidenceLink(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const documentId = (value as Record<string, unknown>).documentId;
  if (typeof documentId !== 'string') return null;
  const normalized = documentId.trim();
  return normalized.length >= 8 && normalized.length <= 100 ? normalized : null;
}
