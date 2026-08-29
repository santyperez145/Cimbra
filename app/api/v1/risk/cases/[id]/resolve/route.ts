import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ApprovalError, resolveRiskCaseWithApprovalPolicy } from '@/db/approvals';
import { LedgerError } from '@/db/ledger';
import { RiskError } from '@/db/risk';

async function resolveCase(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.cases.resolve', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const resolution = body?.resolution === 'approved' || body?.resolution === 'declined' ? body.resolution : null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!resolution || note.length < 3) return NextResponse.json({ error: 'Resolución de caso inválida.', code: 'invalid_case_resolution' }, { status: 400 });
    const result = await resolveRiskCaseWithApprovalPolicy({ organizationId: principal.organizationId,
      actor: principal.user, caseId: id, resolution, note, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    const status = result.requiresApproval && result.approval.status === 'pending' ? 202 : 200;
    return NextResponse.json({ ok: true, ...result }, { status, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ApprovalError || error instanceof RiskError || error instanceof LedgerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => resolveCase(request, (await params).id));
}
