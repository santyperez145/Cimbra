import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveEcheq } from '@/db/echeqs';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const echeq = await retrieveEcheq(principal.organizationId, id);
    if (!echeq) return NextResponse.json({ error: 'ECHEQ no encontrado.', code: 'echeq_not_found' }, { status: 404 });
    return NextResponse.json(echeq, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
