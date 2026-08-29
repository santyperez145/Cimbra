import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveDispute } from '@/db/disputes';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'disputes:read', capability: 'disputes.read' });
    const result = await retrieveDispute(principal.organizationId, id);
    if (!result) return NextResponse.json({ error: 'Disputa no encontrada.', code: 'dispute_not_found' }, { status: 404 });
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
