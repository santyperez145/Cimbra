import { majorToMinor, type Currency } from '../ledger/money.ts';

const systemThresholds: Record<Currency, { elevated: string; high: string }> = {
  ARS: { elevated: '750000', high: '2000000' }, USD: { elevated: '10000', high: '30000' },
  MXN: { elevated: '100000', high: '300000' }, COP: { elevated: '20000000', high: '60000000' },
  BRL: { elevated: '25000', high: '75000' }, CLP: { elevated: '5000000', high: '15000000' },
  PEN: { elevated: '50000', high: '150000' },
};

export function systemAmountRisk(amountMinor: bigint, currency: Currency) {
  const thresholds = systemThresholds[currency];
  const elevatedMinor = majorToMinor(thresholds.elevated, currency);
  const highMinor = majorToMinor(thresholds.high, currency);
  if (amountMinor >= highMinor) return { scoreDelta: 61, forceReview: true, ruleId: 'sys_amount_high', reason: 'amount_high' };
  if (amountMinor >= elevatedMinor) return { scoreDelta: 25, forceReview: false, ruleId: 'sys_amount_elevated', reason: 'amount_elevated' };
  return { scoreDelta: 0, forceReview: false, ruleId: null, reason: null };
}
