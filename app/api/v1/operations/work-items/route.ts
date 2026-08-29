import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listOperationalWork } from '@/db/operations';

async function listWorkItems(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'operations:read', capability: 'operations.read' });
    return NextResponse.json({ data: await listOperationalWork(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listWorkItems(request)); }
