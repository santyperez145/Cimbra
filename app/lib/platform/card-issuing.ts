import { majorToMinor, minorToMajorString, normalizeCurrency, type Currency } from '../ledger/money.ts';

export const CARD_PRODUCTS = ['debit', 'credit', 'prepaid'] as const;
export const CARD_FORMATS = ['virtual', 'physical'] as const;
export const CARD_STATUSES = ['created', 'active', 'frozen', 'terminated'] as const;
export const CARD_CONTROL_CHANNELS = ['ecommerce', 'contactless', 'chip', 'magstripe', 'atm'] as const;

export type CardProduct = typeof CARD_PRODUCTS[number];
export type CardFormat = typeof CARD_FORMATS[number];
export type CardStatus = typeof CARD_STATUSES[number];
export type CardControlChannel = typeof CARD_CONTROL_CHANNELS[number];
export type CardStatusReason = 'activation' | 'user_request' | 'internal_control' | 'suspected_fraud' | 'review_cleared'
  | 'lost' | 'stolen' | 'damaged' | 'customer_request' | 'expired';

export type NormalizedCardProgramInput = {
  name: string;
  product: CardProduct;
  formats: CardFormat[];
  defaultCurrency: Currency;
};

export type NormalizedCardControlsInput = {
  currency: Currency;
  perTransactionLimitMinor: string | null;
  dailyLimitMinor: string | null;
  monthlyLimitMinor: string | null;
  allowedChannels: CardControlChannel[];
  allowedMccs: string[];
  blockedMccs: string[];
  status: 'active' | 'inactive';
};

const transitionReasons: Record<CardStatus, Partial<Record<CardStatus, readonly CardStatusReason[]>>> = {
  created: {
    active: ['activation'],
    terminated: ['lost', 'stolen', 'damaged', 'customer_request'],
  },
  active: {
    frozen: ['user_request', 'internal_control', 'suspected_fraud'],
    terminated: ['lost', 'stolen', 'damaged', 'suspected_fraud', 'customer_request', 'expired'],
  },
  frozen: {
    active: ['user_request', 'internal_control', 'review_cleared'],
    terminated: ['lost', 'stolen', 'damaged', 'suspected_fraud', 'customer_request', 'expired'],
  },
  terminated: {},
};

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uniqueValues<T extends string>(value: unknown, values: readonly T[], maximum = values.length): T[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) return null;
  const normalized = [...new Set(value.filter((item): item is T => typeof item === 'string' && values.includes(item as T)))];
  return normalized.length === value.length ? normalized.sort() : null;
}

function mccList(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const normalized = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : ''))].sort();
  return normalized.length === value.length && normalized.every((item) => /^\d{4}$/.test(item)) ? normalized : null;
}

function optionalLimit(value: unknown, currency: Currency) {
  if (value === null) return null;
  try {
    const amount = majorToMinor(value, currency);
    const maximum = majorToMinor('100000000', currency);
    return amount > 0n && amount <= maximum ? amount : undefined;
  } catch { return undefined; }
}

export function normalizeCardProgramInput(value: unknown): NormalizedCardProgramInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['name', 'product', 'formats', 'defaultCurrency'])) return null;
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const product = oneOf(body.product, CARD_PRODUCTS);
  const formats = uniqueValues(body.formats, CARD_FORMATS);
  const defaultCurrency = normalizeCurrency(body.defaultCurrency);
  return name.length >= 2 && name.length <= 80 && product && formats && defaultCurrency ? { name, product, formats, defaultCurrency } : null;
}

export function initialCardStatus(format: CardFormat): CardStatus {
  return format === 'physical' ? 'created' : 'active';
}

export function normalizeCardTransition(value: unknown, currentStatus: CardStatus) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['status', 'reason'])) return null;
  const status = oneOf(body.status, CARD_STATUSES);
  const reason = typeof body.reason === 'string' ? body.reason as CardStatusReason : null;
  if (!status || !reason || !(transitionReasons[currentStatus][status] ?? []).includes(reason)) return null;
  return { status, reason };
}

export function normalizeCardControlsInput(value: unknown): NormalizedCardControlsInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['currency', 'perTransactionLimit', 'dailyLimit', 'monthlyLimit', 'allowedChannels', 'allowedMccs', 'blockedMccs', 'status'])) return null;
  const currency = normalizeCurrency(body.currency);
  const status = oneOf(body.status, ['active', 'inactive'] as const);
  const allowedChannels = uniqueValues(body.allowedChannels, CARD_CONTROL_CHANNELS);
  const allowedMccs = mccList(body.allowedMccs);
  const blockedMccs = mccList(body.blockedMccs);
  if (!currency || !status || !allowedChannels || !allowedMccs || !blockedMccs) return null;
  if (allowedMccs.some((mcc) => blockedMccs.includes(mcc))) return null;
  const perTransactionLimitMinor = optionalLimit(body.perTransactionLimit, currency);
  const dailyLimitMinor = optionalLimit(body.dailyLimit, currency);
  const monthlyLimitMinor = optionalLimit(body.monthlyLimit, currency);
  if (perTransactionLimitMinor === undefined || dailyLimitMinor === undefined || monthlyLimitMinor === undefined) return null;
  if (perTransactionLimitMinor !== null && dailyLimitMinor !== null && perTransactionLimitMinor > dailyLimitMinor) return null;
  if (dailyLimitMinor !== null && monthlyLimitMinor !== null && dailyLimitMinor > monthlyLimitMinor) return null;
  if (perTransactionLimitMinor !== null && monthlyLimitMinor !== null && perTransactionLimitMinor > monthlyLimitMinor) return null;
  return {
    currency, perTransactionLimitMinor: perTransactionLimitMinor?.toString() ?? null,
    dailyLimitMinor: dailyLimitMinor?.toString() ?? null, monthlyLimitMinor: monthlyLimitMinor?.toString() ?? null,
    allowedChannels, allowedMccs, blockedMccs, status,
  };
}

export function serializeCardLimit(value: string | null, currency: Currency) {
  return value === null ? null : minorToMajorString(value, currency);
}
