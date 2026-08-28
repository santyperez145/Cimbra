import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveProviderConnection } from '@/db/connections';
import { ensureDatabase } from '@/db/runtime';

async function retrieveConnection(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'connections:read' });
    await ensureDatabase();
    const connection = await retrieveProviderConnection(principal.organizationId, id);
    if (!connection) return NextResponse.json({ error: 'Conexión no encontrada.', code: 'connection_not_found' }, { status: 404 });
    return NextResponse.json(connection, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieveConnection(request, (await context.params).id));
}
