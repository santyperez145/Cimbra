import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizeCollectionTillInboundInput } from '@/app/lib/platform/collections-input';
import { ApprovalError, creditCollectionTillWithApprovalPolicy } from '@/db/approvals';
import { CollectionError } from '@/db/collections';
import { LedgerError } from '@/db/ledger';

async function credit(request: Request, tillId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const inbound = normalizeCollectionTillInboundInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!inbound || !rawSignals) {
      return NextResponse.json({ error: 'Datos de acreditación inválidos.', code: 'invalid_collection_till_inbound' }, { status: 400 });
    }
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await creditCollectionTillWithApprovalPolicy({
      organizationId: principal.organizationId, actor: principal.user, tillId, idempotencyKey, inbound, signals,
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
    if (error instanceof IdempotencyError || error instanceof CollectionError || error instanceof LedgerError ||
      error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => credit(request, (await params).id));
}
