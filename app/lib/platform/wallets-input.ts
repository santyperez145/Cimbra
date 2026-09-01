import { CURRENCIES, majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';

export const WALLET_POCKET_KINDS = ['available', 'pending', 'rewards'] as const;
export const WALLET_STATUSES = ['active', 'frozen', 'closed'] as const;

export type WalletPocketKind = typeof WALLET_POCKET_KINDS[number];
export type WalletStatus = typeof WALLET_STATUSES[number];
export type WalletStatusReason = 'issued' | 'user_request' | 'internal_control' | 'suspected_fraud' | 'review_cleared'
  | 'customer_request' | 'compliance';

export type NormalizedWalletProgramInput = {
  name: string;
  displayName: string;
  supportUrl: string | null;
  termsUrl: string | null;
  accentColor: string | null;
  defaultCurrency: Currency;
  allowedCurrencies: Currency[];
  pocketKinds: WalletPocketKind[];
};

export type NormalizedWalletInput = {
  programId: string;
  customerId: string;
  externalReference: string;
};

export type NormalizedWalletPocketTransferInput = {
  externalReference: string;
  sourcePocketId: string;
  destinationPocketId: string;
  description: string;
  amountMinor: bigint;
  currency: Currency;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const transitionReasons: Record<WalletStatus, Partial<Record<WalletStatus, readonly WalletStatusReason[]>>> = {
  active: {
    frozen: ['user_request', 'internal_control', 'suspected_fraud'],
    closed: ['customer_request', 'compliance', 'suspected_fraud'],
  },
  frozen: {
    active: ['user_request', 'internal_control', 'review_cleared'],
    closed: ['customer_request', 'compliance', 'suspected_fraud'],
  },
  closed: {},
};

export const POCKET_LABELS: Record<WalletPocketKind, string> = {
  available: 'Disponible',
  pending: 'Pendiente',
  rewards: 'Recompensas',
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

function collapsedName(value: unknown, maximum = 80) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return name.length >= 2 && name.length <= maximum ? name : '';
}

function optionalHttpsUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (raw.length < 8 || raw.length > 200) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname.length < 3) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function optionalAccent(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const color = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : undefined;
}

export function normalizeWalletProgramInput(value: unknown): NormalizedWalletProgramInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['name', 'displayName', 'supportUrl', 'termsUrl', 'accentColor', 'defaultCurrency', 'allowedCurrencies', 'pocketKinds'])) {
    return null;
  }
  const name = collapsedName(body.name);
  const displayName = collapsedName(body.displayName ?? body.name);
  const supportUrl = optionalHttpsUrl(body.supportUrl);
  const termsUrl = optionalHttpsUrl(body.termsUrl);
  const accentColor = optionalAccent(body.accentColor);
  const defaultCurrency = normalizeCurrency(body.defaultCurrency);
  const allowedSource = body.allowedCurrencies === undefined
    ? (defaultCurrency ? [defaultCurrency] : null)
    : (Array.isArray(body.allowedCurrencies) ? body.allowedCurrencies.map((item) => normalizeCurrency(item)) : null);
  if (!allowedSource || allowedSource.some((item) => !item)) return null;
  const allowedCurrencies = uniqueValues(allowedSource, CURRENCIES);
  const pocketKinds = uniqueValues(body.pocketKinds ?? ['available'], WALLET_POCKET_KINDS);
  if (!name || !displayName || supportUrl === undefined || termsUrl === undefined || accentColor === undefined
    || !defaultCurrency || !allowedCurrencies || !pocketKinds) return null;
  if (!allowedCurrencies.includes(defaultCurrency) || !pocketKinds.includes('available')) return null;
  return { name, displayName, supportUrl, termsUrl, accentColor, defaultCurrency, allowedCurrencies, pocketKinds };
}

export function normalizeWalletInput(value: unknown): NormalizedWalletInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['programId', 'customerId', 'externalReference'])) return null;
  const programId = typeof body.programId === 'string' ? body.programId : '';
  const customerId = typeof body.customerId === 'string' ? body.customerId : '';
  const externalReference = typeof body.externalReference === 'string' ? body.externalReference.trim().slice(0, 100) : '';
  if (!uuid.test(programId) || !uuid.test(customerId) || externalReference.length < 2) return null;
  return { programId, customerId, externalReference };
}

export function normalizeWalletTransition(value: unknown, currentStatus: WalletStatus) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['status', 'reason'])) return null;
  const status = oneOf(body.status, WALLET_STATUSES);
  const reason = typeof body.reason === 'string' ? body.reason as WalletStatusReason : null;
  if (!status || !reason || !(transitionReasons[currentStatus][status] ?? []).includes(reason)) return null;
  return { status, reason };
}

export function parseWalletPocketTransferInput(body: Record<string, unknown> | null): NormalizedWalletPocketTransferInput | null {
  const externalReference = typeof body?.externalReference === 'string' ? body.externalReference.trim().slice(0, 100) : '';
  const sourcePocketId = typeof body?.sourcePocketId === 'string' ? body.sourcePocketId : '';
  const destinationPocketId = typeof body?.destinationPocketId === 'string' ? body.destinationPocketId : '';
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
  const currency = normalizeCurrency(body?.currency);
  if (externalReference.length < 2 || !uuid.test(sourcePocketId) || !uuid.test(destinationPocketId)
    || sourcePocketId === destinationPocketId || description.length < 2 || !currency) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body?.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { externalReference, sourcePocketId, destinationPocketId, description, amountMinor, currency };
}

export function accountStatusForWallet(status: WalletStatus) {
  return status === 'active' ? 'active' : status === 'frozen' ? 'frozen' : 'closed';
}
