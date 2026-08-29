import { NextResponse } from 'next/server';
import { bytesToBase64Url } from '@/app/lib/auth/crypto';
import { normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { csvObjects, CsvError } from '@/app/lib/platform/csv';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeReconciliationDate, normalizeReconciliationEntries, ReconciliationInputError, validateReconciliationWindow } from '@/app/lib/platform/reconciliation-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createReconciliationRun, ReconciliationError, type ReconciliationSource } from '@/db/reconciliation';

const allowedTypes = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', '']);

async function importCsv(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:write', capability: 'reconciliation.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const form = await request.formData();
    const file = form.get('file');
    const name = typeof form.get('name') === 'string' ? String(form.get('name')).trim().slice(0, 100) : '';
    const sourceValue = String(form.get('source') ?? '');
    const source = ['bank', 'clearing', 'card_network', 'cash_network', 'internal'].includes(sourceValue) ? sourceValue as ReconciliationSource : null;
    const currency = normalizeCurrency(form.get('currency'));
    const periodStart = normalizeReconciliationDate(form.get('periodStart'));
    const periodEnd = normalizeReconciliationDate(form.get('periodEnd'));
    if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024 || !allowedTypes.has(file.type) || !file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Adjuntá un CSV UTF-8 de hasta 2 MB.', code: 'invalid_reconciliation_file' }, { status: 400 });
    }
    if (name.length < 2 || !source || !currency || !validateReconciliationWindow(periodStart, periodEnd)) {
      return NextResponse.json({ error: 'Metadata de conciliación inválida.', code: 'invalid_reconciliation_run' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return NextResponse.json({ error: 'El CSV debe usar codificación UTF-8.', code: 'invalid_reconciliation_file' }, { status: 400 }); }
    const rows = csvObjects(text).map((row) => ({
      externalReference: row.external_reference,
      transactionId: row.transaction_id || undefined,
      direction: row.direction,
      amount: row.amount,
    }));
    const entries = normalizeReconciliationEntries(rows, currency);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const fileSha256 = bytesToBase64Url(new Uint8Array(digest));
    const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'reconciliation.csv';
    const result = await createReconciliationRun({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey, name, source, currency,
      periodStart: periodStart!, periodEnd: periodEnd!, entries, ingestionMode: 'csv', fileName, fileSha256,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result, import: { fileName, fileSha256, rowCount: entries.length } }, {
      status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal),
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof CsvError || error instanceof ReconciliationInputError) {
      return NextResponse.json({ error: error.message, code: error instanceof CsvError ? 'invalid_csv' : error.code }, { status: 400 });
    }
    if (error instanceof IdempotencyError || error instanceof ReconciliationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => importCsv(request)); }
