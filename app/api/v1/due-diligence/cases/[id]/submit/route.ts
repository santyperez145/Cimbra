import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { DueDiligenceError, submitDueDiligenceCase } from '@/db/due-diligence';

type Context = { params: Promise<{ id: string }> };

async function submitCase(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:write', capability: 'compliance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const { id } = await context.params;
    const result = await submitDueDiligenceCase({ organizationId: principal.organizationId, actor: principal.user,
      caseId: id, idempotencyKey: `due-diligence-submit:${idempotencyKey}` });
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

export function POST(request: Request, context: Context) { return versionedApi(request, () => submitCase(request, context)); }
