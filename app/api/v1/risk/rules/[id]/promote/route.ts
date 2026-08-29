import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { promoteRiskRule, RiskError } from '@/db/risk';

async function promote(request: Request, ruleId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.rules.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const result = await promoteRiskRule({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, ruleId });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
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
  return versionedApi(request, async () => promote(request, (await params).id));
}
