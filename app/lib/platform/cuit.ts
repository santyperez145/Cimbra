/** Dígito verificador de CUIT/CUIL publicado por AFIP. No consulta padrones ni emite constancias. */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const PREFIXES = new Set(['20', '23', '24', '25', '26', '27', '30', '33', '34']);

function checkDigit(body: string) {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * WEIGHTS[index], 0);
  const mod = 11 - (sum % 11);
  return mod === 11 ? 0 : mod === 10 ? 9 : mod;
}

export function normalizeCuit(value: unknown) {
  if (typeof value !== 'string') return null;
  const digits = value.normalize('NFKC').trim().replace(/[.\-\s]/g, '');
  if (!/^\d{11}$/.test(digits) || !PREFIXES.has(digits.slice(0, 2))) return null;
  return checkDigit(digits.slice(0, 10)) === Number(digits[10]) ? digits : null;
}

export function cuitLast4(value: string) {
  return value.slice(-4);
}
