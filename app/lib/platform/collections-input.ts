import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';
import { normalizeAlias } from './cbu.ts';

export const COLLECTION_METHODS = ['internal', 'sandbox_inbound', 'cimbra_qr', 'cimbra_cvu'] as const;
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
  const raw = value === undefined ? ['internal', 'sandbox_inbound'] : value;
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
  if (!hasOnlyKeys(body, ['accountId', 'externalReference', 'description', 'amount', 'currency', 'expiresInMinutes', 'methods', 'qrDebtId', 'collectionTillId', 'items'])) {
    return null;
  }
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const currency = normalizeCurrency(body.currency);
  const expiresInMinutes = body.expiresInMinutes === undefined ? 60 : Number(body.expiresInMinutes);
  const methods = parseMethods(body.methods);
  const qrDebtId = body.qrDebtId === undefined || body.qrDebtId === null || body.qrDebtId === ''
    ? null : typeof body.qrDebtId === 'string' ? body.qrDebtId : '';
  const collectionTillId = body.collectionTillId === undefined || body.collectionTillId === null || body.collectionTillId === ''
    ? null : typeof body.collectionTillId === 'string' ? body.collectionTillId : '';
  if (!uuid.test(accountId) || !externalReference || !description || currency !== 'ARS'
    || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 10_080 || !methods) {
    return null;
  }
  if (qrDebtId && !uuid.test(qrDebtId)) return null;
  if (collectionTillId && !uuid.test(collectionTillId)) return null;
  if (typeof methods === 'string') {
    return { unsupportedMethod: methods as UnsupportedCollectionMethod };
  }
  if (methods.includes('cimbra_qr') && !qrDebtId) return null;
  if (methods.includes('cimbra_cvu') && !collectionTillId) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  const items = parsePaymentLinkItems(body.items);
  if (!items) return null;
  return {
    accountId, externalReference, description, amountMinor, currency: currency as Currency, expiresInMinutes, methods,
    qrDebtId, collectionTillId, items,
  };
}

export type NormalizedPaymentLinkItem = {
  description: string; amountMinor: bigint; quantity: number; code: string | null; additional: string | null;
};

export function parsePaymentLinkItems(value: unknown): NormalizedPaymentLinkItem[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const items: NormalizedPaymentLinkItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (!hasOnlyKeys(item, ['description', 'amount', 'quantity', 'code', 'additional'])) return null;
    const description = collapsed(item.description, 2, 180);
    const quantity = item.quantity === undefined ? 1 : Number(item.quantity);
    const code = item.code === undefined || item.code === null || item.code === ''
      ? null : collapsed(item.code, 1, 80);
    const additional = item.additional === undefined || item.additional === null || item.additional === ''
      ? null : collapsed(item.additional, 1, 180);
    if (!description || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) return null;
    if (item.code !== undefined && item.code !== null && item.code !== '' && !code) return null;
    if (item.additional !== undefined && item.additional !== null && item.additional !== '' && !additional) return null;
    let itemAmountMinor: bigint;
    try { itemAmountMinor = majorToMinor(item.amount, 'ARS'); } catch { return null; }
    if (itemAmountMinor <= 0n || itemAmountMinor > majorToMinor('10000000', 'ARS')) return null;
    items.push({ description, amountMinor: itemAmountMinor, quantity, code, additional });
  }
  return items;
}

export function storedPaymentLinkItems(items: NormalizedPaymentLinkItem[]) {
  return JSON.stringify(items.map((item) => ({
    description: item.description,
    amountMinor: item.amountMinor.toString(),
    quantity: item.quantity,
    code: item.code,
    additional: item.additional,
  })));
}

export function normalizePaymentLinkPayInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['method', 'payerAccountId', 'amount', 'signals'])) return null;
  const method = typeof body.method === 'string' ? body.method : '';
  if ((UNSUPPORTED_COLLECTION_METHODS as readonly string[]).includes(method)) {
    return { unsupportedMethod: method as UnsupportedCollectionMethod };
  }
  if (!(COLLECTION_METHODS as readonly string[]).includes(method)) return null;
  const payerAccountId = body.payerAccountId === undefined || body.payerAccountId === null || body.payerAccountId === ''
    ? null : typeof body.payerAccountId === 'string' ? body.payerAccountId : '';
  if (method === 'internal' && (!payerAccountId || !uuid.test(payerAccountId))) return null;
  if (method === 'cimbra_qr' && (!payerAccountId || !uuid.test(payerAccountId))) return null;
  if (method === 'sandbox_inbound' && payerAccountId) return null;
  if (method === 'cimbra_cvu' && payerAccountId && !uuid.test(payerAccountId)) return null;
  if (payerAccountId && !uuid.test(payerAccountId)) return null;
  let amountMinor: bigint | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    if (method !== 'cimbra_cvu') return null;
    try { amountMinor = majorToMinor(body.amount, 'ARS'); } catch { return null; }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', 'ARS')) return null;
  }
  return { method: method as CollectionMethod, payerAccountId, amountMinor };
}

export function normalizePaymentLinkRefundInput(value: unknown) {
  if (value === undefined || value === null) return { amountMinor: null, creditId: null };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['amount', 'creditId'])) return null;
  const creditId = body.creditId === undefined || body.creditId === null || body.creditId === ''
    ? null : typeof body.creditId === 'string' ? body.creditId : '';
  if (creditId && !uuid.test(creditId)) return null;
  let amountMinor: bigint | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    try { amountMinor = majorToMinor(body.amount, 'ARS'); } catch { return null; }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', 'ARS')) return null;
  }
  return { amountMinor, creditId };
}

export type NormalizedPaymentLinkInput = Exclude<ReturnType<typeof normalizePaymentLinkInput>, null | { unsupportedMethod: UnsupportedCollectionMethod }>;
export type NormalizedPaymentLinkPayInput = Exclude<ReturnType<typeof normalizePaymentLinkPayInput>, null | { unsupportedMethod: UnsupportedCollectionMethod }>;
export type NormalizedPaymentLinkRefundInput = Exclude<ReturnType<typeof normalizePaymentLinkRefundInput>, null>;

export const TILL_PRESENCE = ['present', 'not_present'] as const;
export type TillPresence = typeof TILL_PRESENCE[number];

function parseBooleanFlag(value: unknown, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : null;
}

export function normalizeCollectionTillInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'externalReference', 'name', 'paymentQrId', 'alias', 'issueStaticQr', 'closedAmountOnly', 'presence'])) {
    return null;
  }
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const name = collapsed(body.name, 2, 80);
  const paymentQrId = body.paymentQrId === undefined || body.paymentQrId === null || body.paymentQrId === ''
    ? null : typeof body.paymentQrId === 'string' ? body.paymentQrId : '';
  const alias = body.alias === undefined || body.alias === null || body.alias === ''
    ? null : normalizeAlias(body.alias);
  const issueStaticQr = parseBooleanFlag(body.issueStaticQr);
  const closedAmountOnly = parseBooleanFlag(body.closedAmountOnly);
  const presence = body.presence === undefined || body.presence === null || body.presence === ''
    ? 'not_present' : body.presence;
  if (!uuid.test(accountId) || !externalReference || !name) return null;
  if (paymentQrId && !uuid.test(paymentQrId)) return null;
  if (body.alias !== undefined && body.alias !== null && body.alias !== '' && !alias) return null;
  if (issueStaticQr === null || closedAmountOnly === null) return null;
  if (typeof presence !== 'string' || !(TILL_PRESENCE as readonly string[]).includes(presence)) return null;
  if (issueStaticQr && paymentQrId) return null;
  return {
    accountId, externalReference, name, paymentQrId, alias, issueStaticQr, closedAmountOnly,
    presence: presence as TillPresence,
  };
}

export function normalizeCollectionTillStaticQrInput(value: unknown) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (!hasOnlyKeys(value as Record<string, unknown>, [])) return null;
  return {};
}

export function normalizeCollectionTillInboundInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['externalReference', 'description', 'amount', 'currency', 'signals'])) return null;
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const currency = normalizeCurrency(body.currency);
  if (!externalReference || !description || (body.currency !== undefined && currency !== 'ARS')) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, 'ARS'); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', 'ARS')) return null;
  return { externalReference, description, amountMinor, currency: 'ARS' as Currency };
}

export type NormalizedCollectionTillInput = Exclude<ReturnType<typeof normalizeCollectionTillInput>, null>;
export type NormalizedCollectionTillInboundInput = Exclude<ReturnType<typeof normalizeCollectionTillInboundInput>, null>;
