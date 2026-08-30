import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { schedulePayoutBatchProcessing, scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { normalizePayoutBatchSubmitInput } from '@/app/lib/platform/payouts-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { submitPayoutBatch } from '@/db/payouts';

export const maxDuration = 300;

async function submit(request: Request, batchId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizePayoutBatchSubmitInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'El envío no acepta parámetros.', code: 'invalid_payout_batch_submit' }, { status: 400 });
    const result = await submitPayoutBatch({ organizationId: principal.organizationId, actor: principal.user, batchId, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.scheduleNow) schedulePayoutBatchProcessing(principal.organizationId, batchId);
    return NextResponse.json({ ok: true, ...result }, { status: result.requiresApproval || ['scheduled', 'processing'].includes(result.batch?.status ?? '') ? 202 : 200,
      headers: rateLimitHeaders(principal) });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => submit(request, id));
}
