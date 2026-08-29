import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { disputeReason, disputeText } from '@/app/lib/platform/disputes';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createDispute, DisputeError, listDisputes } from '@/db/disputes';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'disputes:read', capability: 'disputes.read' });
    return NextResponse.json({ data: await listDisputes(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'disputes:write', capability: 'disputes.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const transactionId = disputeText(body?.transactionId, 100, 8);
    const reason = disputeReason(body?.reason); const description = disputeText(body?.description, 500, 3);
    const currency = normalizeCurrency(body?.currency);
    const provisionalCreditRequested = body?.provisionalCreditRequested === true;
    if (!transactionId || !reason || !description || !currency) {
      return NextResponse.json({ error: 'Datos de disputa inválidos.', code: 'invalid_dispute' }, { status: 400 });
    }
    let amountMinor: bigint;
    try { amountMinor = majorToMinor(body?.amount, currency); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.', code: 'invalid_dispute_amount' }, { status: 400 }); }
    const result = await createDispute({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      transactionId, reason, description, amountMinor, currency, provisionalCreditRequested });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof DisputeError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
