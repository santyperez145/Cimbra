import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRiskStepUpCredential } from '@/app/lib/platform/risk-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { RiskError, verifyRiskStepUpChallenge } from '@/db/risk';

type Context = { params: Promise<{ id: string; challengeId: string }> };

async function verifyChallenge(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.cases.resolve', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const credential = normalizeRiskStepUpCredential(await request.json().catch(() => null));
    if (!credential) return NextResponse.json({ error: 'La credencial debe tener seis dígitos.', code: 'invalid_step_up_credential' }, { status: 400 });
    const { id, challengeId } = await context.params;
    const result = await verifyRiskStepUpChallenge({ organizationId: principal.organizationId, actor: principal.user,
      evaluationId: id, challengeId, credential, idempotencyKey: `step-up-verify:${idempotencyKey}` });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, context: Context) { return versionedApi(request, () => verifyChallenge(request, context)); }
