import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizeInstantTransferInput, RAIL_SCHEMES, type RailScheme } from '@/app/lib/platform/instant-payments-input';
import { ApprovalError, createInstantTransferWithApprovalPolicy } from '@/db/approvals';
import { InstantPaymentError, listInstantTransfers } from '@/db/instant-payments';
import { LedgerError } from '@/db/ledger';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const url = new URL(request.url); const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    const schemeParam = url.searchParams.get('scheme');
    const scheme = schemeParam && RAIL_SCHEMES.includes(schemeParam as RailScheme) ? schemeParam as RailScheme : undefined;
    if (limit === null || cursor === undefined || (schemeParam && !scheme)) {
      return NextResponse.json({ error: 'Paginación o esquema inválidos.', code: 'invalid_pagination' }, { status: 400 });
    }
    const rows = await listInstantTransfers({ organizationId: principal.organizationId, limit, scheme, cursor: cursor ?? undefined });
    return NextResponse.json(paginatedResponse(rows, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof InstantPaymentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const transfer = normalizeInstantTransferInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!transfer || !rawSignals) return NextResponse.json({ error: 'Datos de transferencia instantánea inválidos.', code: 'invalid_instant_transfer' }, { status: 400 });
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await createInstantTransferWithApprovalPolicy({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey, transfer, signals,
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
      return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.',
        code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof InstantPaymentError || error instanceof LedgerError ||
      error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
