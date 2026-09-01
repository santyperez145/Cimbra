import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveRailInstrument } from '@/db/instant-payments';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const instrument = await retrieveRailInstrument(principal.organizationId, id);
    if (!instrument) return NextResponse.json({ error: 'Instrumento no encontrado.', code: 'rail_instrument_not_found' }, { status: 404 });
    return NextResponse.json(instrument, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
