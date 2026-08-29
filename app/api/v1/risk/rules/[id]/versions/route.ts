import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRiskRuleInput } from '@/app/lib/platform/risk-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createRiskRuleVersion, RiskError } from '@/db/risk';

async function createVersion(request: Request, baseRuleId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.rules.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeRiskRuleInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Versión de política inválida.', code: 'invalid_risk_rule' }, { status: 400 });
    const result = await createRiskRuleVersion({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey, baseRuleId, ...input });
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

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => createVersion(request, (await params).id));
}
