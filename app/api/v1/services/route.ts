import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { serviceTopology } from '@/app/lib/platform/service-catalog';
import { versionedApi } from '@/app/lib/platform/versioned-api';

async function topology(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'platform:read', capability: 'console.read' });
    return NextResponse.json({ data: serviceTopology() }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => topology(request)); }
