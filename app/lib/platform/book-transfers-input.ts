import { type Currency, majorToMinor, normalizeCurrency } from '../ledger/money.ts';

export function parseBookTransferInput(body: Record<string, unknown> | null) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const externalReference = typeof body?.externalReference === 'string' ? body.externalReference.trim().slice(0, 100) : '';
  const sourceAccountId = typeof body?.sourceAccountId === 'string' ? body.sourceAccountId : '';
  const destinationAccountId = typeof body?.destinationAccountId === 'string' ? body.destinationAccountId : '';
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
  const currency = normalizeCurrency(body?.currency);
  if (externalReference.length < 2 || !uuid.test(sourceAccountId) || !uuid.test(destinationAccountId) ||
    sourceAccountId === destinationAccountId || description.length < 2 || !currency) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body?.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { externalReference, sourceAccountId, destinationAccountId, description, amountMinor, currency: currency as Currency };
}

export function statementPeriod(url: URL) {
  const now = new Date(); const fallbackFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = url.searchParams.get('from') ?? fallbackFrom.toISOString();
  const to = url.searchParams.get('to') ?? now.toISOString();
  const fromTime = Date.parse(from); const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime ||
    toTime - fromTime > 366 * 24 * 60 * 60 * 1000) return null;
  return { from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString() };
}
