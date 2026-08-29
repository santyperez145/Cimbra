import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRiskSimulationSamples } from '@/app/lib/platform/risk-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { RiskError, simulateRiskRule } from '@/db/risk';

async function simulate(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.rules.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const candidateRuleId = typeof body?.candidateRuleId === 'string' ? body.candidateRuleId.trim() : '';
    const samples = normalizeRiskSimulationSamples(body?.samples);
    if (!candidateRuleId || !samples) {
      return NextResponse.json({ error: 'Simulación inválida: se requieren entre 1 y 50 muestras válidas.', code: 'invalid_risk_simulation' }, { status: 400 });
    }
    const result = await simulateRiskRule({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey, candidateRuleId, samples });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => simulate(request)); }
