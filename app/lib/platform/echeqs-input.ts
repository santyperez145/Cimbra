import { majorToMinor, normalizeCurrency, type Currency } from '../ledger/money.ts';
import { normalizeCuit } from './cuit.ts';

export const UNSUPPORTED_ECHEQ_FEATURES = ['discount', 'custody', 'coelsa_clearing', 'usd'] as const;
export type UnsupportedEcheqFeature = typeof UNSUPPORTED_ECHEQ_FEATURES[number];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function collapsed(value: unknown, min: number, max: number) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length >= min && text.length <= max ? text : '';
}

function todayInArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function parseDate(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return text;
}

function flag(value: unknown) {
  return value === true || value === 'true' || value === 1;
}

export function argentinaToday() {
  return todayInArgentina();
}

export function echeqExpiresOn(paymentDate: string) {
  return addDays(paymentDate, 30);
}

export function normalizeEcheqInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, [
    'drawerAccountId', 'externalReference', 'description', 'amount', 'currency', 'beneficiaryName',
    'beneficiaryTaxId', 'paymentDate', 'toOrder', 'discount', 'custody', 'clearing',
  ])) return null;
  if (flag(body.discount)) return { unsupportedFeature: 'discount' as const };
  if (flag(body.custody)) return { unsupportedFeature: 'custody' as const };
  if (body.clearing === 'coelsa' || body.clearing === 'camara') return { unsupportedFeature: 'coelsa_clearing' as const };
  const currency = body.currency === undefined ? 'ARS' : normalizeCurrency(body.currency);
  if (currency === 'USD') return { unsupportedFeature: 'usd' as const };
  const drawerAccountId = typeof body.drawerAccountId === 'string' ? body.drawerAccountId : '';
  const externalReference = collapsed(body.externalReference, 2, 100);
  const description = collapsed(body.description, 2, 180);
  const beneficiaryName = collapsed(body.beneficiaryName, 2, 120);
  const beneficiaryTaxId = normalizeCuit(body.beneficiaryTaxId);
  const today = todayInArgentina();
  const paymentDate = body.paymentDate === undefined ? today : parseDate(body.paymentDate);
  const toOrder = body.toOrder === undefined ? true : body.toOrder === true || body.toOrder === false ? body.toOrder : null;
  if (!uuid.test(drawerAccountId) || !externalReference || !description || !beneficiaryName || !beneficiaryTaxId
    || currency !== 'ARS' || !paymentDate || toOrder === null) {
    return null;
  }
  if (paymentDate < today || paymentDate > addDays(today, 360)) return null;
  let amountMinor: bigint;
  try { amountMinor = majorToMinor(body.amount, currency); } catch { return null; }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) return null;
  return {
    drawerAccountId, externalReference, description, amountMinor, currency: currency as Currency,
    beneficiaryName, beneficiaryTaxId, paymentDate, toOrder, expiresOn: echeqExpiresOn(paymentDate),
  };
}

export function normalizeEcheqAcceptInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'taxId'])) return null;
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const taxId = normalizeCuit(body.taxId);
  if (!uuid.test(accountId) || !taxId) return null;
  return { accountId, taxId };
}

export function normalizeEcheqEndorseInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['beneficiaryName', 'beneficiaryTaxId', 'discount'])) return null;
  if (flag(body.discount)) return { unsupportedFeature: 'discount' as const };
  const beneficiaryName = collapsed(body.beneficiaryName, 2, 120);
  const beneficiaryTaxId = normalizeCuit(body.beneficiaryTaxId);
  if (!beneficiaryName || !beneficiaryTaxId) return null;
  return { beneficiaryName, beneficiaryTaxId };
}

export function normalizeEcheqDepositInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasOnlyKeys(body, ['accountId', 'taxId', 'destinationKind', 'signals'])) return null;
  if (body.destinationKind === 'cbu' || body.destinationKind === 'cvu' || body.destinationKind === 'coelsa') {
    return { unsupportedFeature: 'coelsa_clearing' as const };
  }
  if (body.destinationKind !== undefined && body.destinationKind !== 'cimbra_account') return null;
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const taxId = normalizeCuit(body.taxId);
  if (!uuid.test(accountId) || !taxId) return null;
  return { accountId, taxId };
}

export function isUnsupportedEcheq(value: object): value is { unsupportedFeature: UnsupportedEcheqFeature } {
  return 'unsupportedFeature' in value
    && (UNSUPPORTED_ECHEQ_FEATURES as readonly string[]).includes((value as { unsupportedFeature?: string }).unsupportedFeature ?? '');
}

export type NormalizedEcheqInput = Exclude<ReturnType<typeof normalizeEcheqInput>, null | { unsupportedFeature: UnsupportedEcheqFeature }>;
export type NormalizedEcheqAcceptInput = Exclude<ReturnType<typeof normalizeEcheqAcceptInput>, null>;
export type NormalizedEcheqEndorseInput = Exclude<ReturnType<typeof normalizeEcheqEndorseInput>, null | { unsupportedFeature: UnsupportedEcheqFeature }>;
export type NormalizedEcheqDepositInput = Exclude<ReturnType<typeof normalizeEcheqDepositInput>, null | { unsupportedFeature: UnsupportedEcheqFeature }>;
