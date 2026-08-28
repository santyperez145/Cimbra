import { CimbraWebhookSignatureError } from './errors.ts';
import type { WebhookEvent } from './types.ts';

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function parseSignature(value: string) {
  const parts = value.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1] ?? '';
  const signatures = parts.filter(([key]) => key === 'v1').map(([, signature]) => signature);
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) {
    throw new CimbraWebhookSignatureError('El header Cimbra-Signature es inválido.');
  }
  return { timestamp, signatures };
}

export async function verifyWebhookSignature(input: {
  payload: string;
  signature: string;
  secret: string;
  timestamp?: string | null;
  toleranceSeconds?: number;
  now?: Date;
}) {
  const { timestamp, signatures } = parseSignature(input.signature);
  if (input.timestamp && input.timestamp !== timestamp) {
    throw new CimbraWebhookSignatureError('Los timestamps de la firma no coinciden.');
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) {
    throw new CimbraWebhookSignatureError('La firma del webhook está fuera de la ventana de tolerancia.');
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(input.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${input.payload}`)));
  const expected = bytesToHex(digest);
  if (!signatures.some((signature) => timingSafeEqual(signature.toLowerCase(), expected))) {
    throw new CimbraWebhookSignatureError('La firma del webhook no es válida.');
  }
  return true;
}

export async function constructWebhookEvent<T = unknown>(input: Parameters<typeof verifyWebhookSignature>[0]) {
  await verifyWebhookSignature(input);
  try {
    return JSON.parse(input.payload) as WebhookEvent<T>;
  } catch {
    throw new CimbraWebhookSignatureError('El payload del webhook no contiene JSON válido.');
  }
}
