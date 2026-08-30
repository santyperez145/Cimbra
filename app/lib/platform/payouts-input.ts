import { majorToMinor, normalizeCurrency } from '../ledger/money.ts';

export type PayoutBeneficiaryType = 'individual' | 'business';
export type PayoutDestinationType = 'local_account' | 'alias' | 'iban' | 'clabe' | 'pix_key';

function objectValue(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return normalized.length >= min ? normalized : null;
}

function reference(value: unknown, min = 2, max = 100) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, max);
  return normalized.length >= min ? normalized : null;
}

function isoDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function normalizePayoutDestination(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '').slice(0, 160);
  return normalized.length >= 4 ? normalized : null;
}

export function normalizePayoutBeneficiaryInput(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  const externalReference = reference(input.externalReference);
  const name = text(input.name, 2, 160);
  const entityType = input.entityType as PayoutBeneficiaryType;
  const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
  const currency = normalizeCurrency(input.currency);
  const destinationType = input.destinationType as PayoutDestinationType;
  const destination = normalizePayoutDestination(input.destination);
  const bankCode = input.bankCode === undefined || input.bankCode === null || input.bankCode === ''
    ? null : reference(input.bankCode, 2, 40);
  if (!externalReference || !name || !['individual', 'business'].includes(entityType) || !/^[A-Z]{2}$/.test(country) ||
      !currency || !['local_account', 'alias', 'iban', 'clabe', 'pix_key'].includes(destinationType) || !destination ||
      (input.bankCode && !bankCode)) return null;
  return { externalReference, name, entityType, country, currency, destinationType, destination, bankCode };
}

export function normalizePayoutBeneficiaryStatus(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  return input.action === 'activate' || input.action === 'suspend' ? input.action : null;
}

export type NormalizedPayoutBatchItem = {
  externalReference: string;
  beneficiaryId: string;
  amountMinor: bigint;
  description: string;
};

export function normalizePayoutBatchInput(raw: unknown) {
  const input = objectValue(raw); if (!input) return null;
  const sourceAccountId = reference(input.sourceAccountId, 1);
  const externalReference = reference(input.externalReference);
  const description = text(input.description, 2, 240);
  const currency = normalizeCurrency(input.currency);
  const scheduledFor = isoDate(input.scheduledFor);
  const processBefore = isoDate(input.processBefore);
  if (!sourceAccountId || !externalReference || !description || !currency || scheduledFor === undefined || processBefore === undefined ||
      !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) return null;
  const items: NormalizedPayoutBatchItem[] = [];
  const itemReferences = new Set<string>();
  for (const rawItem of input.items) {
    const item = objectValue(rawItem); if (!item) return null;
    const itemReference = reference(item.externalReference);
    const beneficiaryId = reference(item.beneficiaryId, 1);
    const itemDescription = text(item.description, 2, 240);
    if (!itemReference || itemReferences.has(itemReference) || !beneficiaryId || !itemDescription) return null;
    let amountMinor: bigint;
    try { amountMinor = majorToMinor(item.amount, currency); } catch { return null; }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
    itemReferences.add(itemReference);
    items.push({ externalReference: itemReference, beneficiaryId, amountMinor, description: itemDescription });
  }
  const now = Date.now();
  if (scheduledFor && Date.parse(scheduledFor) < now - 60_000) return null;
  if (scheduledFor && Date.parse(scheduledFor) > now + 365 * 24 * 60 * 60 * 1_000) return null;
  const effectiveStart = scheduledFor ? Date.parse(scheduledFor) : now;
  if (processBefore && Date.parse(processBefore) <= effectiveStart) return null;
  return { sourceAccountId, externalReference, description, currency, scheduledFor, processBefore, items };
}

export function normalizePayoutBatchSubmitInput(raw: unknown) {
  if (raw === null || raw === undefined) return {};
  const input = objectValue(raw); return input && Object.keys(input).length === 0 ? {} : null;
}
