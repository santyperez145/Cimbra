import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { normalizeDueDiligenceCheckInput } from '@/app/lib/platform/due-diligence-input';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { DueDiligenceError, recordDueDiligenceCheck } from '@/db/due-diligence';

type Context = { params: Promise<{ id: string }> };

async function recordCheck(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:write', capability: 'compliance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeDueDiligenceCheckInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Check de due diligence inválido.', code: 'invalid_due_diligence_check' }, { status: 400 });
    const { id } = await context.params;
    const result = await recordDueDiligenceCheck({ organizationId: principal.organizationId, actor: principal.user,
      caseId: id, idempotencyKey: `due-diligence-check:${idempotencyKey}`, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201,
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof DueDiligenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, context: Context) { return versionedApi(request, () => recordCheck(request, context)); }
