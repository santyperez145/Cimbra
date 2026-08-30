import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRiskStepUpInput } from '@/app/lib/platform/risk-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createRiskStepUpChallenge, listRiskStepUpChallenges, RiskError } from '@/db/risk';

type Context = { params: Promise<{ id: string }> };

async function listChallenges(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:read', capability: 'console.read' });
    const { id } = await context.params;
    return NextResponse.json({ data: await listRiskStepUpChallenges(principal.organizationId, id) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof RiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function createChallenge(request: Request, context: Context) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.cases.resolve', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeRiskStepUpInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Challenge step-up inválido.', code: 'invalid_risk_step_up_challenge' }, { status: 400 });
    const { id } = await context.params;
    const result = await createRiskStepUpChallenge({ organizationId: principal.organizationId, actor: principal.user,
      evaluationId: id, idempotencyKey: `step-up-create:${idempotencyKey}`, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, {
      status: result.replayed ? 200 : 201,
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

export function GET(request: Request, context: Context) { return versionedApi(request, () => listChallenges(request, context)); }
export function POST(request: Request, context: Context) { return versionedApi(request, () => createChallenge(request, context)); }
