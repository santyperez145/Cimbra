import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';

export const COLLECTION_METHODS = ['internal', 'sandbox_inbound'] as const;
export const UNSUPPORTED_COLLECTION_METHODS = ['card', 'pos', 'tap_to_phone', 'qr_interoperable'] as const;

export type CollectionMethod = typeof COLLECTION_METHODS[number];
export type UnsupportedCollectionMethod = typeof UNSUPPORTED_COLLECTION_METHODS[number];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function collapsed(value: unknown, min: number, max: number) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length >= min && text.length <= max ? text : '';
}

function parseMethods(value: unknown): CollectionMethod[] | UnsupportedCollectionMethod | null {
  const raw = value === undefined ? [...COLLECTION_METHODS] : value;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const unsupported = raw.find((item): item is UnsupportedCollectionMethod =>
    typeof item === 'string' && (UNSUPPORTED_COLLECTION_METHODS as readonly string[]).includes(item));
  if (unsupported) return unsupported;
  const methods = [...new Set(raw.filter((item): item is CollectionMethod =>
    typeof item === 'string' && (COLLECTION_METHODS as readonly string[]).includes(item)))];
  return methods.length === raw.length && methods.length > 0 ? methods.sort() : null;
}

export function normalizePaymentLinkInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'externalReference', 'description', 'amount', 'currency', 'expiresInMinutes', 'methods'])) {
    return null;
  }
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const currency = normalizeCurrency(body.currency);
  const expiresInMinutes = body.expiresInMinutes === undefined ? 60 : Number(body.expiresInMinutes);
  const methods = parseMethods(body.methods);
  if (!uuid.test(accountId) || !externalReference || !description || currency !== 'ARS'
    || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 10_080 || !methods) {
    return null;
  }
  if (typeof methods === 'string') {
    return { unsupportedMethod: methods as UnsupportedCollectionMethod };
  }
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { accountId, externalReference, description, amountMinor, currency: currency as Currency, expiresInMinutes, methods };
}

export function normalizePaymentLinkPayInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['method', 'payerAccountId', 'signals'])) return null;
  const method = typeof body.method === 'string' ? body.method : '';
  if ((UNSUPPORTED_COLLECTION_METHODS as readonly string[]).includes(method)) {
    return { unsupportedMethod: method as UnsupportedCollectionMethod };
  }
  if (!(COLLECTION_METHODS as readonly string[]).includes(method)) return null;
  const payerAccountId = body.payerAccountId === undefined || body.payerAccountId === null || body.payerAccountId === ''
    ? null : typeof body.payerAccountId === 'string' ? body.payerAccountId : '';
  if (method === 'internal' && (!payerAccountId || !uuid.test(payerAccountId))) return null;
  if (method === 'sandbox_inbound' && payerAccountId) return null;
  if (payerAccountId && !uuid.test(payerAccountId)) return null;
  return { method: method as CollectionMethod, payerAccountId };
}

export type NormalizedPaymentLinkInput = Exclude<ReturnType<typeof normalizePaymentLinkInput>, null | { unsupportedMethod: UnsupportedCollectionMethod }>;
export type NormalizedPaymentLinkPayInput = Exclude<ReturnType<typeof normalizePaymentLinkPayInput>, null | { unsupportedMethod: UnsupportedCollectionMethod }>;
