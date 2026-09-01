import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { parseWalletPocketTransferInput } from '@/app/lib/platform/wallets-input';
import { ApprovalError } from '@/db/approvals';
import { BookTransferError } from '@/db/book-transfers';
import { WalletError, createWalletPocketTransfer } from '@/db/wallets';

async function create(request: Request, walletId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const parsed = parseWalletPocketTransferInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!parsed || !rawSignals) return NextResponse.json({ error: 'Datos de movimiento entre bolsillos inválidos.', code: 'invalid_wallet_transfer' }, { status: 400 });
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await createWalletPocketTransfer({
      organizationId: principal.organizationId, actor: principal.user, walletId, idempotencyKey, transfer: parsed, signals,
      authentication: principal.authentication, apiKeyId: principal.apiKeyId,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.requiresApproval) return NextResponse.json({ ok: true, ...result }, {
      status: result.approval.status === 'executed' ? 200 : 202, headers: rateLimitHeaders(principal),
    });
    if ('declined' in result) return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.',
      code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof WalletError || error instanceof BookTransferError || error instanceof ApprovalError || error instanceof IdempotencyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => create(request, (await params).id));
}
