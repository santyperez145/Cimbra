export const CURRENCIES = ['ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN'] as const;

export type Currency = typeof CURRENCIES[number];

const currencyExponents: Record<Currency, number> = {
  ARS: 2,
  USD: 2,
  MXN: 2,
  COP: 2,
  BRL: 2,
  CLP: 0,
  PEN: 2,
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && CURRENCIES.includes(value.toUpperCase() as Currency);
}

export function normalizeCurrency(value: unknown): Currency | null {
  return isCurrency(value) ? value.toUpperCase() as Currency : null;
}

export function currencyExponent(currency: Currency) {
  return currencyExponents[currency];
}

export function majorToMinor(value: unknown, currency: Currency): bigint {
  const source = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error('El monto debe ser un decimal positivo sin separadores de miles.');
  const [whole, fraction = ''] = source.split('.');
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) {
    throw new Error(`La moneda ${currency} admite ${exponent} decimales.`);
  }
  const scale = 10n ** BigInt(exponent);
  const minorFraction = exponent === 0 ? 0n : BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0');
  return BigInt(whole) * scale + minorFraction;
}

export function minorToMajorNumber(value: bigint | number | string, currency: Currency): number {
  return Number(value) / 10 ** currencyExponent(currency);
}

export function minorToMajorString(value: bigint | number | string, currency: Currency): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const exponent = currencyExponent(currency);
  if (exponent === 0) return `${negative ? '-' : ''}${absolute}`;
  const digits = absolute.toString().padStart(exponent + 1, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
