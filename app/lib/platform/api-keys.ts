import type { AuthUser } from '@/app/lib/auth/types';
import { getDatabase, recordAuditEvent } from '@/db/runtime';
import { createApiKey, hashApiKey } from './crypto';
import type { ApiScope } from './scopes';

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
  const { prefix, token } = createApiKey();
  await database.prepare(
    `INSERT INTO api_keys
      (id, organization_id, name, prefix, secret_hash, scopes, status, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).bind(id, input.organizationId, input.name, prefix, await hashApiKey(token), JSON.stringify(input.scopes), input.actor.userId, input.expiresAt, createdAt).run();
  await recordAuditEvent({
    organizationId: input.organizationId, actorId: input.actor.userId, action: 'api_key.created', resourceType: 'api_key', resourceId: id,
    payload: { name: input.name, prefix, scopes: input.scopes, expiresAt: input.expiresAt },
  }, database);
  return { key: { id, name: input.name, prefix, scopes: input.scopes, status: 'active', rateLimitPerMinute: 300, lastUsedAt: null, expiresAt: input.expiresAt, createdAt }, secret: token };
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
