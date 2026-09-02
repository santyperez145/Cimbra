/** Check digits publicados para CBU/CVU (mismo cálculo, BCRA SNP). No asigna códigos de PSP de Coelsa. */
const BLOCK1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3];
const BLOCK2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

export const SANDBOX_CVU_PREFIX = '000';
export const SANDBOX_PSP_CODE = '9999';

function checkDigit(block: string, weights: readonly number[]) {
  if (block.length !== weights.length || !/^\d+$/.test(block)) return null;
  const sum = block.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return String((10 - (sum % 10)) % 10);
}

export function isWellFormedCbu(value: string) {
  if (!/^\d{22}$/.test(value)) return false;
  return checkDigit(value.slice(0, 7), BLOCK1_WEIGHTS) === value[7]
    && checkDigit(value.slice(8, 21), BLOCK2_WEIGHTS) === value[21];
}

export function isSandboxCvu(value: string) {
  return isWellFormedCbu(value) && value.startsWith(`${SANDBOX_CVU_PREFIX}${SANDBOX_PSP_CODE}`);
}

export function normalizeAlias(value: unknown) {
  if (typeof value !== 'string') return null;
  const alias = value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '').slice(0, 20);
  if (alias.length < 6 || alias.length > 20) return null;
  if (!/^[A-Z0-9][A-Z0-9._-]{4,18}[A-Z0-9]$/.test(alias)) return null;
  if (/^\d{22}$/.test(alias)) return null;
  return alias;
}

export function classifyRailValue(value: unknown): { kind: 'cbu' | 'cvu' | 'alias'; value: string } | null {
  if (typeof value !== 'string') return null;
  const compact = value.normalize('NFKC').trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{22}$/.test(compact)) {
    if (!isWellFormedCbu(compact)) return null;
    return { kind: compact.startsWith('000') ? 'cvu' : 'cbu', value: compact };
  }
  const alias = normalizeAlias(compact);
  return alias ? { kind: 'alias', value: alias } : null;
}

export function namesMatch(left: string, right: string) {
  return left.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es')
    === right.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

export function railLast4(value: string) {
  return value.slice(-4);
}

export function issueSandboxCvu(accountId: string, discriminator = '') {
  const toDigits = (value: string) => value.replace(/-/g, '').replace(/[a-z]/gi, (char) => String((char.toLowerCase().charCodeAt(0) - 87) % 10)).replace(/\D/g, '');
  const seed = toDigits(accountId);
  const extra = toDigits(discriminator);
  const clientId = extra
    ? Array.from({ length: 12 }, (_, index) => {
      const accountDigit = Number(seed[seed.length - 1 - index] ?? 0);
      const extraDigit = Number(extra[extra.length - 1 - index] ?? 0);
      return String((accountDigit + extraDigit * 3 + index + 1) % 10);
    }).join('')
    : `${seed}000000000000`.slice(0, 12);
  const block1Body = `${SANDBOX_CVU_PREFIX}${SANDBOX_PSP_CODE}`;
  const digit1 = checkDigit(block1Body, BLOCK1_WEIGHTS);
  const block2Body = `0${clientId}`;
  const digit2 = checkDigit(block2Body, BLOCK2_WEIGHTS);
  if (!digit1 || !digit2) throw new Error('cvu_issue_failed');
  return `${block1Body}${digit1}${block2Body}${digit2}`;
}
