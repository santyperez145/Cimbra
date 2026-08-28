import { base64UrlToBytes, bytesToBase64Url, randomToken, sha256 } from '../auth/crypto.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function createApiKey() {
  const prefix = randomToken(9);
  const secret = randomToken(32);
  return { prefix, token: `cim_sk_test_${prefix}_${secret}` };
}

export function apiKeyPrefix(token: string) {
  const match = /^cim_sk_test_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  return match?.[1] ?? null;
}

export async function hashApiKey(token: string) {
  return sha256(`cimbra-api-key:${token}`);
}

export async function verifyApiKey(token: string, expectedHash: string) {
  return constantTimeEqual(await hashApiKey(token), expectedHash);
}

function encryptionKeyBytes() {
  const encoded = process.env.CIMBRA_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('CIMBRA_ENCRYPTION_KEY is not configured.');
  const bytes = /^[a-f0-9]{64}$/i.test(encoded)
    ? Uint8Array.from(encoded.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16))
    : base64UrlToBytes(encoded);
  if (bytes.length !== 32) throw new Error('CIMBRA_ENCRYPTION_KEY must contain exactly 32 bytes.');
  return bytes;
}

async function encryptionKey(usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', encryptionKeyBytes() as BufferSource, { name: 'AES-GCM' }, false, usage);
}

export async function encryptPlatformSecret(secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(['encrypt']), encoder.encode(secret));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptPlatformSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Unsupported encrypted secret format.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(encodedIv) as BufferSource },
    await encryptionKey(['decrypt']),
    base64UrlToBytes(encodedCiphertext) as BufferSource,
  );
  return decoder.decode(plaintext);
}

export function createWebhookSecret() {
  return `whsec_${randomToken(32)}`;
}

export async function signWebhook(secret: string, timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`))));
}

export async function verifyWebhookSignature(secret: string, timestamp: string, rawBody: string, signature: string) {
  return constantTimeEqual(await signWebhook(secret, timestamp, rawBody), signature);
}
