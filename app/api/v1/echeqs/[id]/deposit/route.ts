import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { isUnsupportedEcheq, normalizeEcheqDepositInput } from '@/app/lib/platform/echeqs-input';
import { depositEcheq, EcheqError } from '@/db/echeqs';
import { unsupportedEcheqResponse } from '../../route';

async function create(request: Request, echeqId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const deposit = normalizeEcheqDepositInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!deposit || !rawSignals) return NextResponse.json({ error: 'Datos de depósito inválidos.', code: 'invalid_echeq_deposit' }, { status: 400 });
    if (isUnsupportedEcheq(deposit)) return unsupportedEcheqResponse(deposit.unsupportedFeature);
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await depositEcheq({
      organizationId: principal.organizationId, actor: principal.user, echeqId, idempotencyKey, deposit, signals,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if ('declined' in result) return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.',
      code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof EcheqError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => create(request, (await params).id));
}
