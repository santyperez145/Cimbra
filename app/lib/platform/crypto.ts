import { randomToken, sha256 } from '../auth/crypto.ts';
import { decryptSecret, encryptSecret } from '../security/secrets.ts';

const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export type ApiKeyEnvironment = 'test' | 'live';

export function createApiKey(environment: ApiKeyEnvironment = 'test') {
  const prefix = randomToken(9);
  const secret = randomToken(32);
  return { prefix, environment, token: `cim_sk_${environment}_${prefix}_${secret}` };
}

export function apiKeyEnvironment(token: string): ApiKeyEnvironment | null {
  const match = /^cim_sk_(test|live)_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  return match ? match[1] as ApiKeyEnvironment : null;
}

export function apiKeyPrefix(token: string) {
  const match = /^cim_sk_(?:test|live)_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  return match?.[1] ?? null;
}

export async function hashApiKey(token: string) {
  return sha256(`cimbra-api-key:${token}`);
}

export async function verifyApiKey(token: string, expectedHash: string) {
  return constantTimeEqual(await hashApiKey(token), expectedHash);
}

export const encryptPlatformSecret = encryptSecret;
export const decryptPlatformSecret = decryptSecret;

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
