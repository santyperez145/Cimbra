import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveReconciliationRun } from '@/db/reconciliation';

async function retrieveRun(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:read' });
    const run = await retrieveReconciliationRun(principal.organizationId, id);
    if (!run) return NextResponse.json({ error: 'Conciliación no encontrada.', code: 'reconciliation_run_not_found' }, { status: 404 });
    return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieveRun(request, (await params).id));
}
