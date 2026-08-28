import type { AuthUser } from '@/app/lib/auth/types';
import { sha256 } from '@/app/lib/auth/crypto';
import { encryptPlatformSecret } from '@/app/lib/platform/crypto';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import type { ConnectionTransport, ProviderCapability, ProviderId } from '@/app/lib/platform/providers';
import { getDatabase, recordAuditEvent } from './runtime';

type StoredConnection = {
  id: string; provider: ProviderId; name: string; environment: 'sandbox' | 'production'; capabilities: string;
  transport: ConnectionTransport; configuration: string; status: string; lastCheckedAt: string | null; createdAt: string; updatedAt: string;
};

export type ProviderConnection = Omit<StoredConnection, 'capabilities' | 'configuration'> & {
  capabilities: ProviderCapability[];
  configuration: Record<string, string>;
  credentialConfigured: true;
};

export class ProviderConnectionError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

function serializeConnection(row: StoredConnection): ProviderConnection {
  let capabilities: ProviderCapability[] = [];
  try {
    const parsed = JSON.parse(row.capabilities) as unknown;
    if (Array.isArray(parsed)) capabilities = parsed.filter((item): item is ProviderCapability => typeof item === 'string');
  } catch { /* Invalid legacy metadata is exposed as an empty list. */ }
  return { ...row, capabilities, configuration: parseObject(row.configuration), credentialConfigured: true };
}

export async function listProviderConnections(organizationId: string, requestUrl: string) {
  const url = new URL(requestUrl);
  const limit = pageLimit(url.searchParams.get('limit'));
  const cursor = decodePageCursor(url.searchParams.get('cursor'));
  if (!limit || cursor === undefined) throw new ProviderConnectionError('Paginación inválida.', 400, 'invalid_pagination');
  const rows = await getDatabase().prepare(
    `SELECT id, provider, name, environment, capabilities, transport, configuration, status,
      last_checked_at AS "lastCheckedAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM provider_connections WHERE organization_id = ?
       AND (?::text IS NULL OR (created_at, id) < (?::text, ?::text))
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(organizationId, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1).all<StoredConnection>();
  return paginatedResponse(rows.results.map(serializeConnection), limit);
}

export async function retrieveProviderConnection(organizationId: string, id: string) {
  const row = await getDatabase().prepare(
    `SELECT id, provider, name, environment, capabilities, transport, configuration, status,
      last_checked_at AS "lastCheckedAt", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM provider_connections WHERE organization_id = ? AND id = ? LIMIT 1`,
  ).bind(organizationId, id).first<StoredConnection>();
  return row ? serializeConnection(row) : null;
}

export async function createProviderConnection(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; provider: ProviderId; name: string;
  environment: 'sandbox' | 'production'; capabilities: ProviderCapability[]; transport: ConnectionTransport;
  credentialReference: string; configuration: Record<string, string>;
}) {
  const fingerprint = await sha256(JSON.stringify({
    provider: input.provider, name: input.name, environment: input.environment, capabilities: input.capabilities,
    transport: input.transport, credentialReference: input.credentialReference, configuration: input.configuration,
  }));
  const credentialRefCiphertext = await encryptPlatformSecret(input.credentialReference);
  return getDatabase().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:provider-connection:${input.idempotencyKey}`).run();
    const existing = await database.prepare(
      `SELECT id, provider, name, environment, capabilities, transport, configuration, status, request_fingerprint AS "requestFingerprint",
        last_checked_at AS "lastCheckedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM provider_connections WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<StoredConnection & { requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ProviderConnectionError('La Idempotency-Key ya fue usada con otra configuración.', 409, 'idempotency_mismatch');
      }
      return { connection: serializeConnection(existing), replayed: true };
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await database.prepare(
        `INSERT INTO provider_connections
          (id, organization_id, idempotency_key, request_fingerprint, provider, name, environment, capabilities, transport,
           credential_ref_ciphertext, configuration, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_validation', ?, ?, ?)`,
      ).bind(id, input.organizationId, input.idempotencyKey, fingerprint, input.provider, input.name, input.environment,
        JSON.stringify(input.capabilities), input.transport, credentialRefCiphertext, JSON.stringify(input.configuration), input.actor.userId, now, now).run();
    } catch (error) {
      if (/unique|duplicate/i.test(error instanceof Error ? error.message : '')) {
        throw new ProviderConnectionError('Ya existe una conexión con ese nombre.', 409, 'connection_name_conflict');
      }
      throw error;
    }
    await recordAuditEvent({
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'connection.created',
      resourceType: 'provider_connection', resourceId: id,
      payload: { provider: input.provider, name: input.name, environment: input.environment, capabilities: input.capabilities, transport: input.transport },
    }, database);
    return { connection: serializeConnection({ id, provider: input.provider, name: input.name, environment: input.environment,
      capabilities: JSON.stringify(input.capabilities), transport: input.transport, configuration: JSON.stringify(input.configuration),
      status: 'pending_validation', lastCheckedAt: null, createdAt: now, updatedAt: now }), replayed: false };
  });
}
