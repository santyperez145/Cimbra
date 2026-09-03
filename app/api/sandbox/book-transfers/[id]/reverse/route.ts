import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { ApprovalError, reverseBookTransferWithApprovalPolicy } from '@/db/approvals';
import { BookTransferError } from '@/db/book-transfers';
import { LedgerError } from '@/db/ledger';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal);
    if (!idempotencyKey) throw new IdempotencyError('Idempotency-Key es requerido.');
    const { id } = await context.params;
    const result = await reverseBookTransferWithApprovalPolicy({
      organizationId: principal.organizationId, actor: principal.user, transferId: id, idempotencyKey,
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
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof BookTransferError || error instanceof LedgerError || error instanceof ApprovalError || error instanceof IdempotencyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
