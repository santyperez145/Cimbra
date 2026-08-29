import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { approvalReason } from '@/app/lib/platform/approval-policy';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ApprovalError, decideApprovalRequest } from '@/db/approvals';
import type { OrganizationRole } from '@/db/runtime';

async function reject(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'approvals.decide', mutation: true, sessionOnly: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const reason = approvalReason(body?.reason, true);
    if (reason === null) return NextResponse.json({ error: 'Explicá el rechazo en 3 a 500 caracteres.', code: 'invalid_approval_reason' }, { status: 400 });
    const result = await decideApprovalRequest({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as OrganizationRole, requestId: id, decision: 'reject', reason, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.expired) return NextResponse.json({ error: 'La solicitud venció.', code: 'approval_expired' }, { status: 409 });
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => reject(request, (await params).id));
}
