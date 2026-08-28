const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encoder = new TextEncoder();

export function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function counterBytes(counter: bigint) {
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return bytes;
}

export function createTotpSecret() {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpCode(secret: string, step: bigint, digits = 6) {
  const key = await crypto.subtle.importKey('raw', decodeBase32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(step) as BufferSource));
  const offset = signature[signature.length - 1] & 15;
  const binary = ((signature[offset] & 127) << 24)
    | ((signature[offset + 1] & 255) << 16)
    | ((signature[offset + 2] & 255) << 8)
    | (signature[offset + 3] & 255);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timestamp = Date.now(), periodSeconds = 30) {
  return BigInt(Math.floor(timestamp / 1000 / periodSeconds));
}

function safeCodeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyTotp(secret: string, code: string, options: { timestamp?: number; skew?: number } = {}) {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = totpStep(options.timestamp);
  const skew = options.skew ?? 1;
  for (let offset = -skew; offset <= skew; offset += 1) {
    const step = current + BigInt(offset);
    if (step >= 0n && safeCodeEqual(await totpCode(secret, step), normalized)) return step;
  }
  return null;
}

export function totpProvisioningUri(secret: string, email: string) {
  const issuer = 'Cimbra';
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-F0-9]/g, '');
}

export function createRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return value.match(/.{1,5}/g)?.join('-') ?? value;
}

export async function recoveryCodeHash(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`cimbra-mfa-recovery:${normalizeRecoveryCode(code)}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
