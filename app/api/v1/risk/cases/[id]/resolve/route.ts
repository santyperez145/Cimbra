import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { LedgerError, resolveHold } from '@/db/ledger';
import { getDatabaseClient } from '@/db/client';
import { getRiskCaseForResolution, resolveRiskCase, RiskError } from '@/db/risk';

async function resolveCase(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.cases.resolve', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const resolution = body?.resolution === 'approved' || body?.resolution === 'declined' ? body.resolution : null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!resolution || note.length < 3) return NextResponse.json({ error: 'Resolución de caso inválida.', code: 'invalid_case_resolution' }, { status: 400 });
    const result = await getDatabaseClient().transaction(async (database) => {
      const riskCase = await getRiskCaseForResolution(principal.organizationId, id, database);
      if (!riskCase) throw new RiskError('Caso de riesgo no encontrado.', 404, 'risk_case_not_found');
      if (riskCase.status === 'open' && riskCase.holdId) {
        await resolveHold({ organizationId: principal.organizationId, actor: principal.user, holdId: riskCase.holdId,
          action: resolution === 'approved' ? 'capture' : 'release', idempotencyKey: `risk:${idempotencyKey}` }, database);
      }
      return resolveRiskCase({ organizationId: principal.organizationId, actor: principal.user, caseId: id, resolution, note, idempotencyKey }, database);
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, case: result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError || error instanceof LedgerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => resolveCase(request, (await params).id));
}
