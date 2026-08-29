import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { reportRiskOutcome, RiskError } from '@/db/risk';

const fraudTypes = ['account_takeover', 'identity_fraud', 'scam', 'stolen_instrument', 'merchant_fraud', 'other'] as const;

async function reportOutcome(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.cases.resolve', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const label = body?.label === 'legitimate' || body?.label === 'fraud' ? body.label : null;
    const fraudType = body?.fraudType === undefined || body.fraudType === null || body.fraudType === '' ? null
      : fraudTypes.includes(body.fraudType as typeof fraudTypes[number]) ? body.fraudType as typeof fraudTypes[number] : undefined;
    const currency = body?.currency === undefined || body.currency === null || body.currency === '' ? null : normalizeCurrency(body.currency);
    const note = body?.note === undefined || body.note === null ? '' : typeof body.note === 'string' ? body.note.trim() : null;
    const supersedesOutcomeId = body?.supersedesOutcomeId === undefined || body.supersedesOutcomeId === null || body.supersedesOutcomeId === ''
      ? null : typeof body.supersedesOutcomeId === 'string' ? body.supersedesOutcomeId : undefined;
    let lossAmountMinor = 0n;
    try {
      if (body?.lossAmount !== undefined && body.lossAmount !== null && body.lossAmount !== '') {
        if (!currency) throw new Error('La moneda es obligatoria cuando se informa una pérdida.');
        lossAmountMinor = majorToMinor(body.lossAmount, currency);
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Pérdida inválida.', code: 'invalid_loss_amount' }, { status: 400 });
    }
    if (!label || fraudType === undefined || note === null || note.length > 500 || supersedesOutcomeId === undefined || lossAmountMinor < 0n
      || (label === 'fraud' && !fraudType) || (label === 'legitimate' && (fraudType !== null || lossAmountMinor !== 0n))) {
      return NextResponse.json({ error: 'Resultado de riesgo inválido.', code: 'invalid_risk_outcome' }, { status: 400 });
    }
    const result = await reportRiskOutcome({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey, evaluationId: id, label, fraudType, lossAmountMinor, currency, note, supersedesOutcomeId });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => reportOutcome(request, context));
}
