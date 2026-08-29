import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveCardProgram } from '@/db/card-issuing';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', capability: 'console.read' });
    const program = await retrieveCardProgram(principal.organizationId, id);
    if (!program) {
      return NextResponse.json({ error: 'Programa de tarjetas no encontrado.', code: 'card_program_not_found' }, { status: 404 });
    }
    return NextResponse.json(program, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
