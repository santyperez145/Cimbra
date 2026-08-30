import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';

export type BillerServiceType = 'bill_payment' | 'mobile_topup' | 'gift_card';
export type BillerCategory = 'utilities' | 'telecom' | 'tax' | 'education' | 'health' | 'insurance' | 'transport' | 'entertainment' | 'other';
export type BillerAmountMode = 'exact' | 'range' | 'fixed';
export type RecurringFrequency = 'weekly' | 'monthly';

function objectValue(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return normalized.length >= min ? normalized : null;
}

function isoDate(value: unknown, options: { future?: boolean } = {}) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (options.future && date.getTime() <= Date.now() - 60_000) return null;
  return date.toISOString();
}

export function normalizeProtectedReference(value: unknown) {
  const raw = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  const canonical = raw.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return canonical.length >= 4 ? canonical : null;
}

function amountMinor(value: unknown, currency: Currency) {
  try {
    const amount = majorToMinor(value, currency);
    return amount > 0n && amount <= majorToMinor('10000000', currency) ? amount : null;
  } catch { return null; }
}

export function normalizeBillerInput(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40) : '';
  const name = text(input.name, 2, 160);
  const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
  const category = input.category as BillerCategory;
  const serviceType = input.serviceType as BillerServiceType;
  const currency = normalizeCurrency(input.currency);
  const amountMode = input.amountMode as BillerAmountMode;
  const contractReference = input.contractReference === undefined || input.contractReference === null || input.contractReference === ''
    ? null : text(input.contractReference, 3, 120);
  if (code.length < 2 || !name || !/^[A-Z]{2}$/.test(country) ||
      !['utilities', 'telecom', 'tax', 'education', 'health', 'insurance', 'transport', 'entertainment', 'other'].includes(category) ||
      !['bill_payment', 'mobile_topup', 'gift_card'].includes(serviceType) || !currency || !['exact', 'range', 'fixed'].includes(amountMode) ||
      (input.contractReference && !contractReference)) return null;
  if (serviceType === 'bill_payment' && amountMode !== 'exact') return null;
  const minAmountMinor = amountMode === 'exact' ? null : amountMinor(input.minAmount, currency);
  const maxAmountMinor = amountMode === 'exact' ? null : amountMinor(input.maxAmount ?? input.minAmount, currency);
  if (amountMode !== 'exact' && (!minAmountMinor || !maxAmountMinor || minAmountMinor > maxAmountMinor)) return null;
  if (amountMode === 'fixed' && minAmountMinor !== maxAmountMinor) return null;
  return { code, name, country, category, serviceType, currency, amountMode, minAmountMinor, maxAmountMinor, contractReference };
}

export function normalizeObligationInput(raw: unknown, currency: Currency) {
  const input = objectValue(raw); if (!input) return null;
  const externalReference = text(input.externalReference, 2, 100);
  const subscriberReference = normalizeProtectedReference(input.subscriberReference);
  const amount = amountMinor(input.amount, currency);
  const dueAt = isoDate(input.dueAt);
  const description = text(input.description, 2, 240);
  if (!externalReference || !subscriberReference || !amount || !dueAt || !description) return null;
  return { externalReference, subscriberReference, amountMinor: amount, dueAt, description };
}

export function normalizeBillPaymentInput(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  const accountId = text(input.accountId, 1, 100);
  const billerId = text(input.billerId, 1, 100);
  const obligationId = input.obligationId === undefined || input.obligationId === null || input.obligationId === '' ? null : text(input.obligationId, 1, 100);
  const destinationReference = normalizeProtectedReference(input.destinationReference);
  const amount = input.amount;
  if (!accountId || !billerId || (!obligationId && !destinationReference)) return null;
  return { accountId, billerId, obligationId, destinationReference, amount };
}

export function normalizeMandateInput(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  const accountId = text(input.accountId, 1, 100); const billerId = text(input.billerId, 1, 100);
  const subscriberReference = normalizeProtectedReference(input.subscriberReference);
  const frequency = input.frequency as RecurringFrequency;
  const consentReference = text(input.consentReference, 3, 120);
  const consentedAt = isoDate(input.consentedAt);
  const nextChargeAt = isoDate(input.nextChargeAt, { future: true });
  const maxRetries = input.maxRetries === undefined ? 3 : Number(input.maxRetries);
  if (!accountId || !billerId || !subscriberReference || !['weekly', 'monthly'].includes(frequency) || !consentReference ||
      !consentedAt || Date.parse(consentedAt) > Date.now() + 60_000 || !nextChargeAt || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) return null;
  return { accountId, billerId, subscriberReference, frequency, amount: input.amount, amountLimit: input.amountLimit, consentReference, consentedAt, nextChargeAt, maxRetries };
}

export function normalizeLifecycleAction(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  return input.action === 'activate' || input.action === 'suspend' || input.action === 'pause' || input.action === 'resume' || input.action === 'cancel'
    ? input.action : null;
}
