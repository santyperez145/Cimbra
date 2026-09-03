import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { normalizeLifecycleAction } from '@/app/lib/platform/billers-input';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { updateRecurringMandateStatusWithApprovalPolicy } from '@/db/approvals';

async function update(request: Request, mandateId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const action = normalizeLifecycleAction(await request.json().catch(() => null));
    if (action !== 'pause' && action !== 'resume' && action !== 'cancel') {
      return NextResponse.json({ error: 'Acción de mandato inválida.', code: 'invalid_mandate_action' }, { status: 400 });
    }
    const result = await updateRecurringMandateStatusWithApprovalPolicy({
      organizationId: principal.organizationId, actor: principal.user, mandateId, idempotencyKey, action,
      authentication: principal.authentication, apiKeyId: principal.apiKeyId,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.requiresApproval) {
      if (result.approval.status === 'failed') {
        return NextResponse.json({ error: 'La ejecución aprobada falló.', code: 'approval_execution_failed' },
          { status: 422, headers: rateLimitHeaders(principal) });
      }
      if (['rejected', 'cancelled', 'expired'].includes(result.approval.status)) {
        return NextResponse.json({ error: `La solicitud está ${result.approval.status}.`, code: 'approval_not_pending' },
          { status: 409, headers: rateLimitHeaders(principal) });
      }
      return NextResponse.json({ ok: true, ...result }, {
        status: result.approval.status === 'executed' ? 200 : 202,
        headers: rateLimitHeaders(principal),
      });
    }
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => update(request, id));
}
