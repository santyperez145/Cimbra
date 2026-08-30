import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { normalizeLifecycleAction } from '@/app/lib/platform/billers-input';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { updateRecurringMandateStatus } from '@/db/billers';

async function update(request: Request, mandateId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const action = normalizeLifecycleAction(await request.json().catch(() => null));
    if (action !== 'pause' && action !== 'resume' && action !== 'cancel') return NextResponse.json({ error: 'Acción de mandato inválida.', code: 'invalid_mandate_action' }, { status: 400 });
    const result = await updateRecurringMandateStatus({ organizationId: principal.organizationId, actor: principal.user, mandateId, idempotencyKey, action });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => update(request, id));
}

