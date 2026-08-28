import { decryptPlatformSecret, signWebhook } from '@/app/lib/platform/crypto';
import { assertPublicWebhookDestination } from '@/app/lib/platform/webhook-url';
import { DatabaseClient, getDatabaseClient } from './client';

const RETRY_SECONDS = [60, 300, 1_800, 7_200, 21_600, 86_400];

type ClaimedDelivery = {
  id: string;
  organizationId: string;
  eventId: string;
  endpointId: string;
  attemptCount: number;
  retryCount: number;
};

type DeliveryPayload = ClaimedDelivery & {
  eventType: string;
  payload: string;
  url: string;
  secretCiphertext: string;
  endpointStatus: string;
};

function parsedEventTypes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function enqueueWebhookEvent(database: DatabaseClient, input: {
  organizationId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  data?: Record<string, unknown>;
}) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payload = JSON.stringify({
    id,
    type: input.eventType,
    created_at: createdAt,
    data: { resource_type: input.resourceType, resource_id: input.resourceId, ...(input.data ?? {}) },
  });
  const endpoints = await database.prepare(
    `SELECT id, event_types AS "eventTypes" FROM webhook_endpoints
     WHERE organization_id = ? AND status = 'active' ORDER BY created_at`,
  ).bind(input.organizationId).all<{ id: string; eventTypes: string }>();
  const matching = endpoints.results.filter((endpoint) => {
    const types = parsedEventTypes(endpoint.eventTypes);
    return types.includes('*') || types.includes(input.eventType);
  });
  await database.prepare(
    `INSERT INTO webhook_events (id, organization_id, event_type, resource_type, resource_id, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.organizationId, input.eventType, input.resourceType, input.resourceId, payload, matching.length ? 'pending' : 'skipped', createdAt).run();
  for (const endpoint of matching) {
    await database.prepare(
      `INSERT INTO webhook_deliveries
        (id, organization_id, event_id, endpoint_id, status, attempt_count, retry_count, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.organizationId, id, endpoint.id, createdAt, createdAt, createdAt).run();
  }
  return id;
}

async function claimDeliveries(options: { organizationId?: string; deliveryId?: string; limit?: number }) {
  const database = getDatabaseClient();
  const now = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + 60_000).toISOString();
  const filters = ["status IN ('pending', 'retry', 'processing')", 'next_attempt_at <= ?', '(locked_until IS NULL OR locked_until <= ?)'];
  const parameters: Array<string | number> = [now, now];
  if (options.organizationId) { filters.push('organization_id = ?'); parameters.push(options.organizationId); }
  if (options.deliveryId) { filters.push('id = ?'); parameters.push(options.deliveryId); }
  parameters.push(Math.min(Math.max(options.limit ?? 10, 1), 25), lockedUntil, now);
  const result = await database.prepare(
    `WITH candidates AS (
       SELECT id FROM webhook_deliveries WHERE ${filters.join(' AND ')}
       ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT ?
     )
     UPDATE webhook_deliveries d SET status = 'processing', attempt_count = d.attempt_count + 1,
       retry_count = d.retry_count + 1, locked_until = ?, updated_at = ?
     FROM candidates WHERE d.id = candidates.id
     RETURNING d.id, d.organization_id AS "organizationId", d.event_id AS "eventId", d.endpoint_id AS "endpointId",
       d.attempt_count AS "attemptCount", d.retry_count AS "retryCount"`,
  ).bind(...parameters).all<ClaimedDelivery>();
  return result.results;
}

async function deliveryPayload(claim: ClaimedDelivery) {
  return getDatabaseClient().prepare(
    `SELECT d.id, d.organization_id AS "organizationId", d.event_id AS "eventId", d.endpoint_id AS "endpointId",
      d.attempt_count AS "attemptCount", d.retry_count AS "retryCount", e.event_type AS "eventType", e.payload,
      w.url, w.secret_ciphertext AS "secretCiphertext", w.status AS "endpointStatus"
     FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id
     JOIN webhook_endpoints w ON w.id = d.endpoint_id WHERE d.id = ? LIMIT 1`,
  ).bind(claim.id).first<DeliveryPayload>();
}

export async function refreshWebhookEventStatus(eventId: string, database: DatabaseClient = getDatabaseClient()) {
  const summary = await database.prepare(
    `SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      COUNT(*) FILTER (WHERE status IN ('delivered', 'exhausted', 'cancelled'))::int AS terminal
     FROM webhook_deliveries WHERE event_id = ?`,
  ).bind(eventId).first<{ total: number; delivered: number; terminal: number }>();
  let status = 'pending';
  if (!summary?.total) status = 'skipped';
  else if (summary.delivered === summary.total) status = 'delivered';
  else if (summary.terminal === summary.total) status = summary.delivered > 0 ? 'partial' : 'exhausted';
  await database.prepare('UPDATE webhook_events SET status = ? WHERE id = ?').bind(status, eventId).run();
}

async function completeDelivery(delivery: DeliveryPayload, result: {
  delivered: boolean;
  responseStatus?: number;
  responseExcerpt?: string;
  error?: string;
}) {
  const database = getDatabaseClient();
  const now = new Date().toISOString();
  const exhausted = !result.delivered && delivery.retryCount >= RETRY_SECONDS.length + 1;
  const status = result.delivered ? 'delivered' : exhausted ? 'exhausted' : 'retry';
  const nextAttemptAt = result.delivered || exhausted
    ? now
    : new Date(Date.now() + RETRY_SECONDS[Math.max(0, delivery.retryCount - 1)] * 1000).toISOString();
  await database.transaction(async (transaction) => {
    await transaction.prepare(
      `INSERT INTO webhook_delivery_attempts
        (id, organization_id, delivery_id, attempt_number, status, response_status, response_excerpt, error, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), delivery.organizationId, delivery.id, delivery.attemptCount,
      result.delivered ? 'delivered' : 'failed', result.responseStatus ?? null,
      result.responseExcerpt?.slice(0, 400) ?? null, result.error?.slice(0, 400) ?? null, now, now,
    ).run();
    await transaction.prepare(
      `UPDATE webhook_deliveries SET status = ?, next_attempt_at = ?, locked_until = NULL,
        response_status = ?, response_excerpt = ?, last_error = ?, delivered_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      status, nextAttemptAt, result.responseStatus ?? null, result.responseExcerpt?.slice(0, 400) ?? null,
      result.error?.slice(0, 400) ?? null, result.delivered ? now : null, now, delivery.id,
    ).run();
    await refreshWebhookEventStatus(delivery.eventId, transaction);
  });
  return status;
}

async function deliver(claim: ClaimedDelivery) {
  const delivery = await deliveryPayload(claim);
  if (!delivery) return { id: claim.id, status: 'missing' };
  if (delivery.endpointStatus !== 'active') {
    await getDatabaseClient().prepare(
      "UPDATE webhook_deliveries SET status = 'cancelled', locked_until = NULL, last_error = 'Endpoint disabled', updated_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), delivery.id).run();
    await refreshWebhookEventStatus(delivery.eventId);
    return { id: delivery.id, status: 'cancelled' };
  }
  try {
    const url = await assertPublicWebhookDestination(delivery.url);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = await decryptPlatformSecret(delivery.secretCiphertext);
    const signature = await signWebhook(secret, timestamp, delivery.payload);
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(4_000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Cimbra-Webhooks/1.0',
        'Cimbra-Event-Id': delivery.eventId,
        'Cimbra-Delivery-Id': delivery.id,
        'Cimbra-Timestamp': timestamp,
        'Cimbra-Signature': `t=${timestamp},v1=${signature}`,
      },
      body: delivery.payload,
    });
    const excerpt = `${response.status} ${response.statusText}`.trim();
    await response.body?.cancel().catch(() => undefined);
    const status = await completeDelivery(delivery, { delivered: response.status >= 200 && response.status < 300, responseStatus: response.status, responseExcerpt: excerpt, error: response.status >= 200 && response.status < 300 ? undefined : 'El endpoint no respondió con 2xx.' });
    return { id: delivery.id, status };
  } catch (error) {
    const status = await completeDelivery(delivery, { delivered: false, error: error instanceof Error ? error.message : 'Falló la entrega.' });
    return { id: delivery.id, status };
  }
}

export async function dispatchWebhookDeliveries(options: { organizationId?: string; deliveryId?: string; limit?: number } = {}) {
  const claims = await claimDeliveries(options);
  const results = [];
  for (const claim of claims) results.push(await deliver(claim));
  return results;
}

export async function replayWebhookDelivery(organizationId: string, deliveryId: string) {
  const now = new Date().toISOString();
  const delivery = await getDatabaseClient().prepare(
    `UPDATE webhook_deliveries SET status = 'pending', retry_count = 0, next_attempt_at = ?, locked_until = NULL,
      last_error = NULL, updated_at = ? WHERE id = ? AND organization_id = ?
     RETURNING id`,
  ).bind(now, now, deliveryId, organizationId).first<{ id: string }>();
  return delivery?.id ?? null;
}
