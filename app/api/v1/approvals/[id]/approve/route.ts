import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { approvalReason } from '@/app/lib/platform/approval-policy';
import { schedulePayoutBatchProcessing, scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ApprovalError, decideApprovalRequest } from '@/db/approvals';
import { LedgerError } from '@/db/ledger';
import { ReconciliationError } from '@/db/reconciliation';
import { RiskError } from '@/db/risk';
import { SettlementError } from '@/db/settlements';
import { PayoutError } from '@/db/payouts';
import type { OrganizationRole } from '@/db/runtime';

export const maxDuration = 300;

async function approve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'approvals.decide', mutation: true, sessionOnly: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const reason = approvalReason(body?.reason);
    if (reason === null) return NextResponse.json({ error: 'Motivo inválido.', code: 'invalid_approval_reason' }, { status: 400 });
    const result = await decideApprovalRequest({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as OrganizationRole, requestId: id, decision: 'approve', reason, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (!result.replayed && result.payoutBatch && result.payoutBatch.status === 'processing') {
      schedulePayoutBatchProcessing(principal.organizationId, result.payoutBatch.id);
    }
    if (result.expired) return NextResponse.json({ error: 'La solicitud venció.', code: 'approval_expired' }, { status: 409 });
    if (result.failed) return NextResponse.json({ error: result.failed.message, code: result.failed.code }, { status: result.failed.status });
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ApprovalError || error instanceof LedgerError ||
      error instanceof RiskError || error instanceof ReconciliationError || error instanceof SettlementError || error instanceof PayoutError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => approve(request, (await params).id));
}
