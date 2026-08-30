import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listDueDiligenceState } from '@/db/due-diligence';

async function listState(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:read', capability: 'console.read' });
    return NextResponse.json({ data: await listDueDiligenceState(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listState(request)); }
