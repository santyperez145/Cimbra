import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { classifyRailValue } from '@/app/lib/platform/cbu';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { lookupRailDirectory } from '@/db/instant-payments';

async function lookup(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const destination = classifyRailValue(new URL(request.url).searchParams.get('q'));
    if (!destination) return NextResponse.json({ error: 'CBU, CVU o alias inválido.', code: 'invalid_rail_destination' }, { status: 400 });
    const preview = await lookupRailDirectory(principal.organizationId, destination);
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => lookup(request)); }
