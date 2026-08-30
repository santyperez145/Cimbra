import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { normalizeDueDiligenceDecisionInput } from '@/app/lib/platform/due-diligence-input';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { decideDueDiligenceCase, DueDiligenceError } from '@/db/due-diligence';

type Context = { params: Promise<{ id: string }> };

async function decideCase(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:write', capability: 'approvals.decide', mutation: true, sessionOnly: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeDueDiligenceDecisionInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Decisión KYC/KYB inválida.', code: 'invalid_due_diligence_decision' }, { status: 400 });
    const { id } = await context.params;
    const result = await decideDueDiligenceCase({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role, caseId: id, idempotencyKey: `due-diligence-decide:${idempotencyKey}`, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof DueDiligenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, context: Context) { return versionedApi(request, () => decideCase(request, context)); }
