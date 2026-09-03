import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ApprovalError, createAccountPaymentWithApprovalPolicy } from '@/db/approvals';
import { LedgerError } from '@/db/ledger';
import { ensureDatabase, OrganizationAccessError } from '@/db/runtime';

async function createPayment(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const direction = body?.direction === 'cash_in' || body?.direction === 'cash_out' ? body.direction : null;
    const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
    const currency = normalizeCurrency(body?.currency);
    const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!accountId || !direction || counterparty.length < 2 || description.length < 2 || !currency || !rawSignals) {
      return NextResponse.json({ error: 'Datos de pago inválidos.' }, { status: 400 });
    }
    let amountMinor: bigint;
    try { amountMinor = majorToMinor(body?.amount, currency); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.' }, { status: 400 }); }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return NextResponse.json({ error: 'Monto fuera de rango.' }, { status: 400 });
    await ensureDatabase();
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await createAccountPaymentWithApprovalPolicy({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      accountId, direction, counterparty, description, amountMinor, currency, signals,
      authentication: principal.authentication, apiKeyId: principal.apiKeyId,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.requiresApproval) {
      if (result.approval.status === 'failed') {
        return NextResponse.json({ error: 'La ejecución aprobada falló.', code: 'approval_execution_failed' },
          { status: 422, headers: rateLimitHeaders(principal) });
      }
      if (['rejected', 'cancelled', 'expired'].includes(result.approval.status)) {
        return NextResponse.json({ error: `La solicitud está ${result.approval.status}.`, code: 'approval_not_pending' },
          { status: 409, headers: rateLimitHeaders(principal) });
      }
      return NextResponse.json({ ok: true, ...result }, {
        status: result.approval.status === 'executed' ? 200 : 202,
        headers: rateLimitHeaders(principal),
      });
    }
    if ('declined' in result) {
      return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.', code: 'risk_declined', evaluation: result.declined },
        { status: 422, headers: rateLimitHeaders(principal) });
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof LedgerError || error instanceof ApprovalError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof OrganizationAccessError ? 'forbidden' : error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createPayment(request)); }
