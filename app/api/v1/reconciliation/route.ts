import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listReconciliationState } from '@/db/reconciliation';

async function getState(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:read' });
    return NextResponse.json({ data: await listReconciliationState(principal.organizationId) }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => getState(request)); }
