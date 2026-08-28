export type ReconciliationMatchEntry = { externalReference: string; transactionId: string | null; actualMinor: bigint };
export type ReconciliationMatchItem = {
  id: string; transactionId: string | null; externalReference: string; expectedMinor: bigint; actualMinor: bigint;
  differenceMinor: bigint; status: 'matched' | 'mismatch' | 'missing_internal' | 'missing_external'; reason: string | null;
};

export function matchReconciliationEntries(
  internalRows: Array<{ id: string; amountMinor: string }>,
  entries: ReconciliationMatchEntry[],
): ReconciliationMatchItem[] {
  const internal = new Map(internalRows.map((transaction) => [transaction.id, BigInt(transaction.amountMinor)]));
  const referenced = new Set<string>();
  const items: ReconciliationMatchItem[] = [];
  for (const entry of entries) {
    const expected = entry.transactionId ? internal.get(entry.transactionId) : undefined;
    if (entry.transactionId && expected !== undefined) referenced.add(entry.transactionId);
    const status = expected === undefined ? 'missing_internal' : expected === entry.actualMinor ? 'matched' : 'mismatch';
    const expectedMinor = expected ?? 0n;
    items.push({ id: crypto.randomUUID(), transactionId: expected === undefined ? null : entry.transactionId, externalReference: entry.externalReference,
      expectedMinor, actualMinor: entry.actualMinor, differenceMinor: entry.actualMinor - expectedMinor, status,
      reason: status === 'missing_internal' ? 'No existe un movimiento Cimbra asociado.' : status === 'mismatch' ? 'El monto externo difiere del ledger.' : null });
  }
  for (const [transactionId, expectedMinor] of internal) {
    if (referenced.has(transactionId)) continue;
    items.push({ id: crypto.randomUUID(), transactionId, externalReference: `cimbra:${transactionId}`, expectedMinor, actualMinor: 0n,
      differenceMinor: -expectedMinor, status: 'missing_external', reason: 'El movimiento Cimbra no aparece en el lote externo.' });
  }
  return items;
}
