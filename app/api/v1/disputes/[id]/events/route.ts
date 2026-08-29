import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { disputeEvent, disputeText } from '@/app/lib/platform/disputes';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ApprovalError, transitionDisputeWithApprovalPolicy } from '@/db/approvals';
import { DisputeError } from '@/db/disputes';
import { LedgerError } from '@/db/ledger';

async function transition(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'disputes:write', capability: 'disputes.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const event = disputeEvent(body?.event); const note = disputeText(body?.note, 500, 3);
    if (!event || !note) return NextResponse.json({ error: 'Transición de disputa inválida.', code: 'invalid_dispute_event' }, { status: 400 });
    const result = await transitionDisputeWithApprovalPolicy({ organizationId: principal.organizationId, actor: principal.user,
      disputeId: id, event, note, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    const status = result.requiresApproval && result.approval.status === 'pending' ? 202 : 200;
    return NextResponse.json({ ok: true, ...result }, { status, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ApprovalError || error instanceof DisputeError || error instanceof LedgerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => transition(request, (await params).id));
}
