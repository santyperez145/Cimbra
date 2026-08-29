import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listRiskState } from '@/db/risk';

async function getRiskState(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:read', capability: 'console.read' });
    return NextResponse.json({ data: await listRiskState(principal.organizationId) }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => getRiskState(request)); }
