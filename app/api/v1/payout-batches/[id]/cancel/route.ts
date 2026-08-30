import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { cancelPayoutBatch } from '@/db/payouts';

async function cancel(request: Request, batchId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const result = await cancelPayoutBatch({ organizationId: principal.organizationId, actor: principal.user, batchId, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => cancel(request, id));
}
