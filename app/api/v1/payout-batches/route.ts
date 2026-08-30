import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { normalizePayoutBatchInput } from '@/app/lib/platform/payouts-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createPayoutBatch, listPayoutBatches } from '@/db/payouts';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:read', capability: 'console.read' });
    return NextResponse.json({ data: await listPayoutBatches(principal.organizationId) },
      { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizePayoutBatchInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Lote de payouts inválido.', code: 'invalid_payout_batch' }, { status: 400 });
    const result = await createPayoutBatch({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
