import type { AuthUser } from '@/app/lib/auth/types';
import { getDatabase, recordAuditEvent } from '@/db/runtime';
import { refreshWebhookEventStatus } from '@/db/platform';
import { createWebhookSecret, encryptPlatformSecret } from './crypto';
import { assertPublicWebhookDestination } from './webhook-url';

export const WEBHOOK_EVENT_TYPES = [
  'customer.created', 'account.created', 'card.created', 'transfer.created', 'transfer.reversed',
  'hold.captured', 'hold.released', 'payment.created', 'risk.rule_created', 'risk.rule_disabled',
  'risk.case_created', 'risk.case_resolved', 'reconciliation.run_created', 'reconciliation.exception_resolved',
  'settlement.cycle_created', 'settlement.cycle_settled',
  'approval.policy_updated', 'approval.request_created', 'approval.request_executed',
  'approval.request_rejected', 'approval.request_cancelled', 'approval.request_expired',
  'organization.invitation_created', 'organization.invitation_accepted', 'organization.invitation_revoked',
  'organization.member_role_updated', 'organization.member_removed',
  'compliance.document_uploaded',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number] | '*';

export function normalizeWebhookEventTypes(value: unknown): WebhookEventType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const allowed = new Set<string>(['*', ...WEBHOOK_EVENT_TYPES]);
  const unique = [...new Set(value.filter((item): item is WebhookEventType => typeof item === 'string' && allowed.has(item)))].sort();
  return unique.length === value.length ? unique : null;
}

function parseEventTypes(value: string) {
  try { return JSON.parse(value) as WebhookEventType[]; } catch { return []; }
}

export async function listOrganizationWebhooks(organizationId: string) {
  const database = getDatabase();
  const [endpoints, deliveries, attempts] = await Promise.all([
    database.prepare(
      `SELECT id, name, url, event_types AS "eventTypes", status, secret_rotated_at AS "secretRotatedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM webhook_endpoints WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(organizationId).all<{
      id: string; name: string; url: string; eventTypes: string; status: string; secretRotatedAt: string; createdAt: string; updatedAt: string;
    }>(),
    database.prepare(
      `SELECT d.id, d.event_id AS "eventId", d.endpoint_id AS "endpointId", e.event_type AS "eventType",
        d.status, d.attempt_count AS "attemptCount", d.retry_count AS "retryCount", d.next_attempt_at AS "nextAttemptAt",
        d.response_status AS "responseStatus", d.last_error AS "lastError", d.delivered_at AS "deliveredAt", d.created_at AS "createdAt"
       FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id
       WHERE d.organization_id = ? ORDER BY d.created_at DESC LIMIT 100`,
    ).bind(organizationId).all(),
    database.prepare(
      `SELECT id, delivery_id AS "deliveryId", attempt_number AS "attemptNumber", status,
        response_status AS "responseStatus", error, started_at AS "startedAt", completed_at AS "completedAt"
       FROM webhook_delivery_attempts WHERE organization_id = ? ORDER BY started_at DESC LIMIT 100`,
    ).bind(organizationId).all(),
  ]);
  return {
    endpoints: endpoints.results.map((endpoint) => ({ ...endpoint, eventTypes: parseEventTypes(endpoint.eventTypes) })),
    deliveries: deliveries.results,
    attempts: attempts.results,
  };
}

export async function createOrganizationWebhook(input: {
  organizationId: string;
  actor: AuthUser;
  name: string;
  url: string;
  eventTypes: WebhookEventType[];
}) {
  const url = await assertPublicWebhookDestination(input.url);
  const secret = createWebhookSecret();
  const secretCiphertext = await encryptPlatformSecret(secret);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDatabase().transaction(async (database) => {
    await database.prepare(
      `INSERT INTO webhook_endpoints
        (id, organization_id, name, url, event_types, secret_ciphertext, status, created_by, secret_rotated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, input.name, url, JSON.stringify(input.eventTypes), secretCiphertext, input.actor.userId, now, now, now).run();
    await recordAuditEvent({
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'webhook.endpoint_created',
      resourceType: 'webhook_endpoint', resourceId: id, payload: { name: input.name, url, eventTypes: input.eventTypes },
    }, database);
  });
  return { endpoint: { id, name: input.name, url, eventTypes: input.eventTypes, status: 'active', secretRotatedAt: now, createdAt: now, updatedAt: now }, secret };
}

export async function disableOrganizationWebhook(organizationId: string, actor: AuthUser, id: string) {
  return getDatabase().transaction(async (database) => {
    const now = new Date().toISOString();
    const endpoint = await database.prepare(
      `UPDATE webhook_endpoints SET status = 'disabled', updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'active' RETURNING id`,
    ).bind(now, id, organizationId).first<{ id: string }>();
    if (!endpoint) return false;
    const affectedEvents = await database.prepare(
      `SELECT DISTINCT event_id AS id FROM webhook_deliveries
       WHERE endpoint_id = ? AND status IN ('pending', 'retry', 'processing')`,
    ).bind(id).all<{ id: string }>();
    await database.prepare(
      `UPDATE webhook_deliveries SET status = 'cancelled', locked_until = NULL, updated_at = ?
       WHERE endpoint_id = ? AND status IN ('pending', 'retry', 'processing')`,
    ).bind(now, id).run();
    for (const event of affectedEvents.results) await refreshWebhookEventStatus(event.id, database);
    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'webhook.endpoint_disabled', resourceType: 'webhook_endpoint', resourceId: id }, database);
    return true;
  });
}

export async function rotateOrganizationWebhookSecret(organizationId: string, actor: AuthUser, id: string) {
  const secret = createWebhookSecret();
  const ciphertext = await encryptPlatformSecret(secret);
  return getDatabase().transaction(async (database) => {
    const now = new Date().toISOString();
    const endpoint = await database.prepare(
      `UPDATE webhook_endpoints SET secret_ciphertext = ?, secret_rotated_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'active' RETURNING id`,
    ).bind(ciphertext, now, now, id, organizationId).first<{ id: string }>();
    if (!endpoint) return null;
    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'webhook.secret_rotated', resourceType: 'webhook_endpoint', resourceId: id }, database);
    return { secret, secretRotatedAt: now };
  });
}
