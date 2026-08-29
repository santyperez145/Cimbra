import { NextResponse } from 'next/server';
import { normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeReconciliationDate, normalizeReconciliationEntries, ReconciliationInputError, validateReconciliationWindow } from '@/app/lib/platform/reconciliation-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createReconciliationRun, ReconciliationError, type ReconciliationSource } from '@/db/reconciliation';

async function createRun(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:write', capability: 'reconciliation.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const source = ['bank', 'clearing', 'card_network', 'cash_network', 'internal'].includes(String(body?.source)) ? body?.source as ReconciliationSource : null;
    const currency = normalizeCurrency(body?.currency);
    const periodStart = normalizeReconciliationDate(body?.periodStart); const periodEnd = normalizeReconciliationDate(body?.periodEnd);
    const rawEntries = Array.isArray(body?.entries) ? body.entries : null;
    if (name.length < 2 || !source || !currency || !validateReconciliationWindow(periodStart, periodEnd) || !rawEntries) {
      return NextResponse.json({ error: 'Lote de conciliación inválido.', code: 'invalid_reconciliation_run' }, { status: 400 });
    }
    const entries = normalizeReconciliationEntries(rawEntries, currency);
    const result = await createReconciliationRun({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      name, source, currency, periodStart: periodStart!, periodEnd: periodEnd!, entries, ingestionMode: 'api' });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof ReconciliationInputError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    if (error instanceof IdempotencyError || error instanceof ReconciliationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createRun(request)); }
