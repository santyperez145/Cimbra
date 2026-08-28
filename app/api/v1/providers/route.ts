import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { PROVIDERS } from '@/app/lib/platform/providers';
import { versionedApi } from '@/app/lib/platform/versioned-api';

async function listProviders(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'connections:read' });
    return NextResponse.json({ data: PROVIDERS }, { headers: { 'Cache-Control': 'private, max-age=300', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listProviders(request)); }
