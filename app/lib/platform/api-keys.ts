import type { AuthUser } from '@/app/lib/auth/types';
import { getDatabase, recordAuditEvent } from '@/db/runtime';
import { createApiKey, hashApiKey } from './crypto';
import { requireLiveApiKeysEnabled } from './live-readiness';
import type { ApiScope } from './scopes';
import { sha256 } from '@/app/lib/auth/crypto';
import { getDatabaseClient, type DatabaseClient } from '@/db/client';
import { approvalSelect, type ApprovalRow, ApprovalError } from '@/db/approvals';

export type SafeApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rateLimitPerMinute: number;
  createdAt: string;
};

function parseScopes(value: string) {
  try { return JSON.parse(value) as ApiScope[]; } catch { return []; }
}

export async function listOrganizationApiKeys(organizationId: string) {
  const rows = await getDatabase().prepare(
    `SELECT id, name, prefix, scopes, status, rate_limit_per_minute AS "rateLimitPerMinute",
      last_used_at AS "lastUsedAt", expires_at AS "expiresAt", created_at AS "createdAt"
     FROM api_keys WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(organizationId).all<Omit<SafeApiKey, 'scopes'> & { scopes: string }>();
  return rows.results.map((row) => ({ ...row, scopes: parseScopes(row.scopes) }));
}

async function insertApiKey(database: ReturnType<typeof getDatabase>, input: {
  organizationId: string;
  actor: AuthUser;
  name: string;
  scopes: ApiScope[];
  expiresAt: string | null;
}) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { prefix, token, environment } = createApiKey('test');
  if (environment === 'live') requireLiveApiKeysEnabled();
  await database.prepare(
    `INSERT INTO api_keys
      (id, organization_id, name, prefix, secret_hash, scopes, status, created_by, expires_at, created_at, environment)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).bind(id, input.organizationId, input.name, prefix, await hashApiKey(token), JSON.stringify(input.scopes), input.actor.userId, input.expiresAt, createdAt, environment).run();
  await recordAuditEvent({
    organizationId: input.organizationId, actorId: input.actor.userId, action: 'api_key.created', resourceType: 'api_key', resourceId: id,
    payload: { name: input.name, prefix, scopes: input.scopes, expiresAt: input.expiresAt },
  }, database);
  return { key: { id, name: input.name, prefix, scopes: input.scopes, status: 'active', rateLimitPerMinute: 300, lastUsedAt: null, expiresAt: input.expiresAt, createdAt }, secret: token };
}

export async function createOrganizationApiKeyWithApprovalPolicy(input: {
  organizationId: string;
  actor: AuthUser;
  name: string;
  scopes: ApiScope[];
  expiresAt: string | null;
  idempotencyKey: string;
  authentication: 'session' | 'api_key';
  apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({
    actionType: 'api_key.create', name: input.name, scopes: input.scopes, expiresAt: input.expiresAt,
  }));

  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:api-key:${input.idempotencyKey}`).first();

    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();

    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'api_key' ||
        existingApproval.actionType !== 'api_key.create') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: existingApproval, replayed: true, deduplicated: false };
    }

    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:api_key.create`).first();

    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'api_key.create' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await insertApiKey(database, input);
      return { requiresApproval: false as const, ...result };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();

    const payload = {
      name: input.name, scopes: input.scopes, expiresAt: input.expiresAt,
      origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true,
    };

    await database.prepare(
      `INSERT INTO approval_requests (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status, request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'api_key.create', 'api_key', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, id, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId, expiresAt, now, now).run();

    await recordAuditEvent({ organizationId: input.organizationId, actorId: input.actor.userId, action: 'api_key.create', resourceType: 'approval_request', resourceId: id, payload }, database);

    return { requiresApproval: true as const, approval: { id, actionType: 'api_key.create' as const, resourceType: 'api_key' as const, resourceId: id, status: 'pending' as const, requestFingerprint: fingerprint, requestPayload: JSON.stringify(payload), requestedBy: input.actor.userId, requestedByName: input.actor.displayName ?? input.actor.userId, resolvedBy: null, resolvedByName: null, resolutionReason: null, expiresAt, resolvedAt: null, executedAt: null, createdAt: now, updatedAt: now }, replayed: false, deduplicated: false };
  });
}

export async function createOrganizationApiKey(input: {
  organizationId: string;
  actor: AuthUser;
  name: string;
  scopes: ApiScope[];
  expiresAt: string | null;
}) {
  return getDatabase().transaction((database) => insertApiKey(database, input));
}

export async function revokeOrganizationApiKey(organizationId: string, actor: AuthUser, id: string) {
  return getDatabase().transaction(async (database) => {
    const now = new Date().toISOString();
    const revoked = await database.prepare(
      `UPDATE api_keys SET status = 'revoked', revoked_at = ?
        WHERE id = ? AND organization_id = ? AND status = 'active' RETURNING id`,
    ).bind(now, id, organizationId).first<{ id: string }>();
    if (!revoked) return false;
    await recordAuditEvent({ organizationId, actorId: actor.userId, action: 'api_key.revoked', resourceType: 'api_key', resourceId: id }, database);
    return true;
  });
}

export async function rotateOrganizationApiKey(organizationId: string, actor: AuthUser, id: string) {
  return getDatabase().transaction(async (database) => {
    const current = await database.prepare(
      `SELECT name, scopes, expires_at AS "expiresAt" FROM api_keys
       WHERE id = ? AND organization_id = ? AND status = 'active' FOR UPDATE`,
    ).bind(id, organizationId).first<{ name: string; scopes: string; expiresAt: string | null }>();
    if (!current) return null;
    const replacement = await insertApiKey(database, {
      organizationId, actor, name: `${current.name} (rotada)`.slice(0, 80), scopes: parseScopes(current.scopes), expiresAt: current.expiresAt,
    });
    const now = new Date().toISOString();
    await database.prepare("UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ?").bind(now, id).run();
    await recordAuditEvent({
      organizationId, actorId: actor.userId, action: 'api_key.rotated', resourceType: 'api_key', resourceId: id,
      payload: { replacementId: replacement.key.id },
    }, database);
    return replacement;
  });
}