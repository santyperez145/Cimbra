import { majorToMinor, type Currency } from '../ledger/money.ts';
import type { ReconciliationEntry } from '../../../db/reconciliation.ts';

export class ReconciliationInputError extends Error {
  readonly code: string;
  constructor(message: string, code = 'invalid_reconciliation_run') { super(message); this.code = code; }
}

export function normalizeReconciliationDate(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function validateReconciliationWindow(periodStart: string | null, periodEnd: string | null) {
  return Boolean(periodStart && periodEnd && periodStart < periodEnd &&
    Date.parse(periodEnd) - Date.parse(periodStart) <= 31 * 24 * 60 * 60 * 1000);
}

export function normalizeReconciliationEntries(rawEntries: unknown[], currency: Currency) {
  if (rawEntries.length > 500) throw new ReconciliationInputError('El lote supera 500 partidas.');
  const entries: ReconciliationEntry[] = [];
  const references = new Set<string>();
  const transactionIds = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReconciliationInputError('Entrada de conciliación inválida.', 'invalid_reconciliation_entry');
    const entry = raw as Record<string, unknown>;
    const externalReference = typeof entry.externalReference === 'string' ? entry.externalReference.trim().slice(0, 120) : '';
    const rawTransactionId = typeof entry.transactionId === 'string' ? entry.transactionId.trim() : '';
    const transactionId = rawTransactionId.length === 0 ? null : uuid.test(rawTransactionId) ? rawTransactionId : undefined;
    const direction = entry.direction === 'credit' || entry.direction === 'debit' ? entry.direction : null;
    if (externalReference.length < 2 || /[\u0000-\u001f\u007f]/.test(externalReference) || !direction || transactionId === undefined || references.has(externalReference) ||
        (transactionId !== null && transactionIds.has(transactionId))) {
      throw new ReconciliationInputError('Referencias, movimientos o dirección duplicados/inválidos.', 'invalid_reconciliation_entry');
    }
    let amountMinor: bigint;
    try { amountMinor = majorToMinor(entry.amount, currency); }
    catch (error) { throw new ReconciliationInputError(error instanceof Error ? error.message : 'Monto inválido.', 'invalid_reconciliation_entry'); }
    if (amountMinor <= 0n) throw new ReconciliationInputError('Cada importe debe ser positivo.', 'invalid_reconciliation_entry');
    references.add(externalReference);
    if (transactionId) transactionIds.add(transactionId);
    entries.push({ externalReference, transactionId, actualMinor: direction === 'credit' ? amountMinor : -amountMinor });
  }
  return entries;
}
