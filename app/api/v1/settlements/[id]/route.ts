import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveSettlementCycle } from '@/db/settlements';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'settlements:read', capability: 'console.read' });
    const cycle = await retrieveSettlementCycle(principal.organizationId, id);
    if (!cycle) return NextResponse.json({ error: 'Ciclo de settlement no encontrado.', code: 'settlement_cycle_not_found' }, { status: 404 });
    return NextResponse.json(cycle, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
