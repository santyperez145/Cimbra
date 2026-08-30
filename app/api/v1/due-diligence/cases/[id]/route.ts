import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { DueDiligenceError, retrieveDueDiligenceCase } from '@/db/due-diligence';

type Context = { params: Promise<{ id: string }> };

async function retrieveCase(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:read', capability: 'console.read' });
    const { id } = await context.params;
    return NextResponse.json({ data: await retrieveDueDiligenceCase(principal.organizationId, id) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof DueDiligenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function GET(request: Request, context: Context) { return versionedApi(request, () => retrieveCase(request, context)); }
