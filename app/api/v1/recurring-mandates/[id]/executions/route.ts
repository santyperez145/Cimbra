import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listRecurringMandateExecutions } from '@/db/billers';

async function listExecutions(request: Request, mandateId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:read', capability: 'console.read' });
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const data = await listRecurringMandateExecutions(principal.organizationId, mandateId, limit);
    if (!data) return NextResponse.json({ error: 'Mandato no encontrado.', code: 'mandate_not_found' }, { status: 404 });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = billerApiErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return versionedApi(request, () => listExecutions(request, id));
}
