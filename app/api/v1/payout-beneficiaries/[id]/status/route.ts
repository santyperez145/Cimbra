import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { normalizePayoutBeneficiaryStatus } from '@/app/lib/platform/payouts-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { updatePayoutBeneficiaryStatus } from '@/db/payouts';

async function update(request: Request, beneficiaryId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:write', capability: 'payouts.beneficiaries.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const action = normalizePayoutBeneficiaryStatus(await request.json().catch(() => null));
    if (!action) return NextResponse.json({ error: 'Transición de beneficiario inválida.', code: 'invalid_payout_beneficiary_action' }, { status: 400 });
    const result = await updatePayoutBeneficiaryStatus({ organizationId: principal.organizationId, actor: principal.user,
      beneficiaryId, action, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => update(request, id));
}
