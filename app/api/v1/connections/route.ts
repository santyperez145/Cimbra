import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { requestIdempotencyKey, IdempotencyError } from '@/app/lib/platform/idempotency';
import {
  normalizeConnectionTransport, normalizeCredentialReference, normalizeProviderCapabilities,
  normalizeProviderConfiguration, providerDescriptor,
} from '@/app/lib/platform/providers';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createProviderConnection, listProviderConnections, ProviderConnectionError } from '@/db/connections';
import { ensureDatabase } from '@/db/runtime';

async function listConnections(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'connections:read', roles: ['owner', 'admin', 'operator', 'viewer'] });
    await ensureDatabase();
    const page = await listProviderConnections(principal.organizationId, request.url);
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    if (error instanceof ProviderConnectionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function createConnection(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'connections:write', roles: ['owner', 'admin'], mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const provider = providerDescriptor(body?.provider);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const environment = body?.environment === 'sandbox' || body?.environment === 'production' ? body.environment : null;
    const capabilities = provider ? normalizeProviderCapabilities(provider, body?.capabilities) : null;
    const transport = provider ? normalizeConnectionTransport(provider, body?.transport) : null;
    const credentialReference = normalizeCredentialReference(body?.credentialReference);
    const configuration = normalizeProviderConfiguration(body?.configuration);
    if (!provider || name.length < 2 || !environment || !capabilities || !transport || !credentialReference || !configuration) {
      return NextResponse.json({ error: 'Configuración de conexión inválida.', code: 'invalid_connection' }, { status: 400 });
    }
    await ensureDatabase();
    const result = await createProviderConnection({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      provider: provider.id, name, environment, capabilities, transport, credentialReference, configuration });
    return NextResponse.json({ ok: true, ...result }, {
      status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    if (error instanceof IdempotencyError || error instanceof ProviderConnectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listConnections(request)); }
export function POST(request: Request) { return versionedApi(request, () => createConnection(request)); }
