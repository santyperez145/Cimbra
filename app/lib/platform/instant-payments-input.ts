import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';
import { classifyRailValue, normalizeAlias } from './cbu.ts';

export const RAIL_SCHEMES = ['credit_push', 'debit_pull', 'qr_collect'] as const;
export const TRANSFER_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const;
export const INSTRUMENT_KINDS = ['cvu', 'alias'] as const;
export const COUNTERPARTY_KINDS = ['cvu', 'cbu', 'alias'] as const;

export type RailScheme = typeof RAIL_SCHEMES[number];
export type TransferDirection = typeof TRANSFER_DIRECTIONS[number];
export type InstrumentKind = typeof INSTRUMENT_KINDS[number];
export type CounterpartyKind = typeof COUNTERPARTY_KINDS[number];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function collapsed(value: unknown, min: number, max: number) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length >= min && text.length <= max ? text : '';
}

export const ALIAS_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function aliasChangeBlocked(valueChangedAt: string | null | undefined, now = Date.now()) {
  if (!valueChangedAt) return false;
  const changedAt = Date.parse(valueChangedAt);
  return Number.isFinite(changedAt) && now - changedAt < ALIAS_CHANGE_WINDOW_MS;
}

export function normalizeAssignAliasInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['alias'])) return null;
  const alias = normalizeAlias(body.alias);
  return alias ? { alias } : null;
}

export function normalizeIssueInstrumentInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'alias'])) return null;
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const alias = body.alias === undefined || body.alias === null || body.alias === '' ? null : normalizeAlias(body.alias);
  if (!uuid.test(accountId) || alias === undefined) return null;
  if (body.alias !== undefined && body.alias !== null && body.alias !== '' && !alias) return null;
  return { accountId, alias };
}

export function normalizeDirectoryQuery(value: unknown) {
  return classifyRailValue(value);
}

export function normalizeInstantTransferInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['externalReference', 'accountId', 'destination', 'description', 'amount', 'currency', 'direction', 'confirmHolder', 'holderName', 'taxIdLast4', 'signals'])) {
    return null;
  }
  const externalReference = collapsed(body.externalReference, 2, 100);
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const destination = classifyRailValue(body.destination);
  const description = collapsed(body.description, 2, 180);
  const currency = normalizeCurrency(body.currency);
  const direction = body.direction === 'inbound' ? 'inbound' : body.direction === 'outbound' || body.direction === undefined ? 'outbound' : null;
  const confirmHolder = body.confirmHolder === true;
  const holderName = collapsed(body.holderName, 2, 160);
  const taxIdLast4 = typeof body.taxIdLast4 === 'string' && /^\d{4}$/.test(body.taxIdLast4) ? body.taxIdLast4 : '';
  if (!externalReference || !uuid.test(accountId) || !destination || !description || currency !== 'ARS' || !direction || !confirmHolder || !holderName || !taxIdLast4) {
    return null;
  }
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { externalReference, accountId, destination, description, amountMinor, currency: currency as Currency, direction, holderName, taxIdLast4 };
}

export function normalizeDebitRequestInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['externalReference', 'collectorAccountId', 'payerDestination', 'description', 'amount', 'currency', 'expiresInMinutes'])) return null;
  const externalReference = collapsed(body.externalReference, 2, 100);
  const collectorAccountId = typeof body.collectorAccountId === 'string' ? body.collectorAccountId : '';
  const payerDestination = classifyRailValue(body.payerDestination);
  const description = collapsed(body.description, 2, 180);
  const currency = normalizeCurrency(body.currency);
  const expiresInMinutes = body.expiresInMinutes === undefined ? 60 : Number(body.expiresInMinutes);
  if (!externalReference || !uuid.test(collectorAccountId) || !payerDestination || !description || currency !== 'ARS'
    || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 1440) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { externalReference, collectorAccountId, payerDestination, description, amountMinor, currency: currency as Currency, expiresInMinutes };
}

export function normalizeDebitResponse(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['decision', 'signals'])) return null;
  if (body.decision === 'accept') return { decision: 'accept' as const };
  if (body.decision === 'reject') return { decision: 'reject' as const };
  return null;
}

export function normalizePaymentQrInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'amount', 'currency', 'description', 'expiresInMinutes', 'kind'])) return null;
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const description = collapsed(body.description, 2, 180);
  const currency = body.currency === undefined || body.currency === null || body.currency === '' ? 'ARS' : normalizeCurrency(body.currency);
  const kind = body.kind === 'static' ? 'static' : body.kind === 'dynamic' || body.kind === undefined ? 'dynamic' : null;
  if (!uuid.test(accountId) || !description || currency !== 'ARS' || !kind) return null;
  if (kind === 'static') {
    if (body.amount !== undefined && body.amount !== null && body.amount !== '') return null;
    if (body.expiresInMinutes !== undefined && body.expiresInMinutes !== null && body.expiresInMinutes !== '') return null;
    return { accountId, description, amountMinor: null, currency: currency as Currency, kind, expiresInMinutes: null };
  }
  const expiresInMinutes = body.expiresInMinutes === undefined ? 60 : Number(body.expiresInMinutes);
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 1440) return null;
  let amountMinor: bigint | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  }
  return { accountId, description, amountMinor, currency: currency as Currency, kind, expiresInMinutes };
}

export function normalizeQrPayInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['sourceAccountId', 'amount', 'externalReference', 'signals'])) return null;
  const sourceAccountId = typeof body.sourceAccountId === 'string' ? body.sourceAccountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  if (!uuid.test(sourceAccountId) || !externalReference) return null;
  let amountMinor: bigint | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    try { amountMinor = majorToMinor(body.amount, 'ARS'); } catch { return null; }
    if (amountMinor <= 0n) return null;
  }
  return { sourceAccountId, externalReference, amountMinor };
}

export function normalizeQrSaleOrderInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['paymentQrId', 'externalReference', 'description', 'amount', 'currency', 'expiresInMinutes'])) return null;
  const paymentQrId = typeof body.paymentQrId === 'string' ? body.paymentQrId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const currency = body.currency === undefined || body.currency === null || body.currency === '' ? 'ARS' : normalizeCurrency(body.currency);
  const expiresInMinutes = body.expiresInMinutes === undefined ? 10 : Number(body.expiresInMinutes);
  if (!uuid.test(paymentQrId) || !externalReference || !description || currency !== 'ARS'
    || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 1440) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { paymentQrId, externalReference, description, amountMinor, currency: currency as Currency, expiresInMinutes };
}

export function normalizeQrDebtInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'externalReference', 'description', 'amount', 'currency', 'expiresInMinutes'])) return null;
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const currency = body.currency === undefined || body.currency === null || body.currency === '' ? 'ARS' : normalizeCurrency(body.currency);
  const expiresInMinutes = body.expiresInMinutes === undefined ? 1440 : Number(body.expiresInMinutes);
  if (!uuid.test(accountId) || !externalReference || !description || currency !== 'ARS'
    || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 5 || expiresInMinutes > 1440) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return { accountId, externalReference, description, amountMinor, currency: currency as Currency, expiresInMinutes };
}

export type NormalizedIssueInstrumentInput = NonNullable<ReturnType<typeof normalizeIssueInstrumentInput>>;
export type NormalizedAssignAliasInput = NonNullable<ReturnType<typeof normalizeAssignAliasInput>>;
export type NormalizedInstantTransferInput = NonNullable<ReturnType<typeof normalizeInstantTransferInput>>;
export type NormalizedDebitRequestInput = NonNullable<ReturnType<typeof normalizeDebitRequestInput>>;
export type NormalizedDebitResponse = NonNullable<ReturnType<typeof normalizeDebitResponse>>;
export type NormalizedPaymentQrInput = NonNullable<ReturnType<typeof normalizePaymentQrInput>>;
export type NormalizedQrPayInput = NonNullable<ReturnType<typeof normalizeQrPayInput>>;
export type NormalizedQrSaleOrderInput = NonNullable<ReturnType<typeof normalizeQrSaleOrderInput>>;
export type NormalizedQrDebtInput = NonNullable<ReturnType<typeof normalizeQrDebtInput>>;

