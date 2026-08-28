import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createReconciliationRun, ReconciliationError, type ReconciliationEntry, type ReconciliationSource } from '@/db/reconciliation';

function normalizeDate(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

async function createRun(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const source = ['bank', 'clearing', 'card_network', 'cash_network', 'internal'].includes(String(body?.source)) ? body?.source as ReconciliationSource : null;
    const currency = normalizeCurrency(body?.currency);
    const periodStart = normalizeDate(body?.periodStart); const periodEnd = normalizeDate(body?.periodEnd);
    const rawEntries = Array.isArray(body?.entries) ? body.entries : null;
    if (name.length < 2 || !source || !currency || !periodStart || !periodEnd || periodStart >= periodEnd ||
        Date.parse(periodEnd) - Date.parse(periodStart) > 31 * 24 * 60 * 60 * 1000 || !rawEntries || rawEntries.length > 500) {
      return NextResponse.json({ error: 'Lote de conciliación inválido.', code: 'invalid_reconciliation_run' }, { status: 400 });
    }
    const entries: ReconciliationEntry[] = [];
    const references = new Set<string>(); const transactionIds = new Set<string>();
    for (const raw of rawEntries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Entrada de conciliación inválida.' }, { status: 400 });
      const entry = raw as Record<string, unknown>;
      const externalReference = typeof entry.externalReference === 'string' ? entry.externalReference.trim().slice(0, 120) : '';
      const transactionId = typeof entry.transactionId === 'string' && /^[0-9a-f-]{36}$/i.test(entry.transactionId) ? entry.transactionId : null;
      const direction = entry.direction === 'credit' || entry.direction === 'debit' ? entry.direction : null;
      if (externalReference.length < 2 || !direction || references.has(externalReference) || (transactionId !== null && transactionIds.has(transactionId))) {
        return NextResponse.json({ error: 'Referencias, movimientos o dirección duplicados/inválidos.', code: 'invalid_reconciliation_entry' }, { status: 400 });
      }
      let amountMinor: bigint;
      try { amountMinor = majorToMinor(entry.amount, currency); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.' }, { status: 400 }); }
      if (amountMinor <= 0n) return NextResponse.json({ error: 'Cada importe debe ser positivo.' }, { status: 400 });
      references.add(externalReference); if (transactionId) transactionIds.add(transactionId);
      entries.push({ externalReference, transactionId, actualMinor: direction === 'credit' ? amountMinor : -amountMinor });
    }
    const result = await createReconciliationRun({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      name, source, currency, periodStart, periodEnd, entries });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ReconciliationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createRun(request)); }
