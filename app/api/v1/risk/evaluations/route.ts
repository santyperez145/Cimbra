import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { evaluateAndPersistRisk, RiskError, type RiskOperation } from '@/db/risk';

async function createEvaluation(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const operationType = ['transfer', 'cash_in', 'cash_out'].includes(String(body?.operationType)) ? body?.operationType as RiskOperation : null;
    const currency = normalizeCurrency(body?.currency);
    const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : '';
    if (!operationType || !currency || counterparty.length < 2) return NextResponse.json({ error: 'Evaluación de riesgo inválida.', code: 'invalid_risk_evaluation' }, { status: 400 });
    let amountMinor: bigint;
    try { amountMinor = majorToMinor(body?.amount, currency); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.' }, { status: 400 }); }
    if (amountMinor <= 0n) return NextResponse.json({ error: 'El monto debe ser positivo.' }, { status: 400 });
    const evaluation = await evaluateAndPersistRisk({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey: `evaluation:${idempotencyKey}`, operationType, amountMinor, currency, counterparty });
    if (!evaluation.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, evaluation, replayed: evaluation.replayed }, { status: evaluation.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createEvaluation(request)); }
