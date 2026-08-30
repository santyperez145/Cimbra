import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { payoutBatchResultCsv } from '@/db/payouts';

async function result(request: Request, batchId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:read', capability: 'console.read' });
    const file = await payoutBatchResultCsv(principal.organizationId, batchId);
    if (!file) return Response.json({ error: 'Lote de payouts no encontrado.', code: 'payout_batch_not_found' },
      { status: 404, headers: rateLimitHeaders(principal) });
    return new Response(file.csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`, 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => result(request, id));
}
