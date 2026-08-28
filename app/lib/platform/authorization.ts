import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import type { AuthUser } from '@/app/lib/auth/types';
import { ensureDatabase, getDatabase, requireOrganizationRole, type OrganizationRole } from '@/db/runtime';
import { apiKeyPrefix, verifyApiKey } from './crypto';
import type { ApiScope } from './scopes';

export type ApiPrincipal = {
  user: AuthUser;
  organizationId: string;
  role: OrganizationRole | 'api_key';
  authentication: 'session' | 'api_key';
  apiKeyId: string | null;
};

export class ApiAuthorizationError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new ApiAuthorizationError('Authorization debe usar el esquema Bearer.', 401, 'invalid_authorization');
  return match[1].trim();
}

function parseScopes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

async function authenticateApiKey(token: string, requiredScope?: ApiScope): Promise<ApiPrincipal> {
  const prefix = apiKeyPrefix(token);
  if (!prefix) throw new ApiAuthorizationError('API key inválida.', 401, 'invalid_api_key');
  await ensureDatabase();
  const key = await getDatabase().prepare(
    `SELECT k.id, k.organization_id AS "organizationId", k.secret_hash AS "secretHash", k.scopes,
      k.status, k.expires_at AS "expiresAt", u.id AS "userId", u.username, u.display_name AS "displayName",
      u.email, u.email_verified AS "emailVerified"
     FROM api_keys k JOIN users u ON u.id = k.created_by
     WHERE k.prefix = ? LIMIT 1`,
  ).bind(prefix).first<{
    id: string; organizationId: string; secretHash: string; scopes: string; status: string; expiresAt: string | null;
    userId: string; username: string; displayName: string; email: string; emailVerified: number;
  }>();
  if (!key || key.status !== 'active' || (key.expiresAt && key.expiresAt <= new Date().toISOString()) || !(await verifyApiKey(token, key.secretHash))) {
    throw new ApiAuthorizationError('API key inválida, revocada o vencida.', 401, 'invalid_api_key');
  }
  const scopes = parseScopes(key.scopes);
  if (requiredScope && !scopes.includes(requiredScope)) {
    throw new ApiAuthorizationError(`La API key no incluye el scope ${requiredScope}.`, 403, 'insufficient_scope');
  }
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - 60_000).toISOString();
  const consumed = await getDatabase().prepare(
    `UPDATE api_keys SET last_used_at = ?,
      rate_window_count = CASE WHEN rate_window_started_at IS NULL OR rate_window_started_at <= ? THEN 1 ELSE rate_window_count + 1 END,
      rate_window_started_at = CASE WHEN rate_window_started_at IS NULL OR rate_window_started_at <= ? THEN ? ELSE rate_window_started_at END
     WHERE id = ? AND (rate_window_started_at IS NULL OR rate_window_started_at <= ? OR rate_window_count < rate_limit_per_minute)
     RETURNING id`,
  ).bind(now.toISOString(), windowThreshold, windowThreshold, now.toISOString(), key.id, windowThreshold).first<{ id: string }>();
  if (!consumed) throw new ApiAuthorizationError('Se superó el límite de solicitudes de la API key.', 429, 'rate_limit_exceeded');
  return {
    user: { userId: key.userId, username: key.username, displayName: key.displayName, email: key.email, emailVerified: key.emailVerified === 1 },
    organizationId: key.organizationId,
    role: 'api_key', authentication: 'api_key', apiKeyId: key.id,
  };
}

export async function authorizeApiRequest(request: Request, options: {
  scope?: ApiScope;
  roles?: readonly OrganizationRole[];
  mutation?: boolean;
  sessionOnly?: boolean;
} = {}): Promise<ApiPrincipal> {
  const token = bearerToken(request);
  if (token && options.sessionOnly) throw new ApiAuthorizationError('Esta operación requiere una sesión de consola.', 403, 'session_required');
  if (token) return authenticateApiKey(token, options.scope);
  if (options.mutation && !mutationAllowed(request)) {
    throw new ApiAuthorizationError('Origen de solicitud no permitido.', 403, 'origin_not_allowed');
  }
  const user = await getCurrentUser(request);
  if (!user) throw new ApiAuthorizationError('Autenticación requerida.', 401, 'authentication_required');
  const context = await requireOrganizationRole(user, options.roles ?? ['owner', 'admin', 'operator', 'viewer']);
  return { user, organizationId: context.organizationId, role: context.role, authentication: 'session', apiKeyId: null };
}

export function authorizationErrorResponse(error: unknown) {
  if (error instanceof ApiAuthorizationError) {
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: error.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Cimbra API"' } : error.status === 429 ? { 'Retry-After': '60' } : undefined,
    });
  }
  return null;
}
