import { base64UrlToBytes, bytesToBase64Url } from '../auth/crypto.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function encryptSecret(secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(['encrypt']), encoder.encode(secret));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(value: string) {
  const [version, encodedIv, encodedCiphertext] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Unsupported encrypted secret format.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(encodedIv) as BufferSource },
    await encryptionKey(['decrypt']),
    base64UrlToBytes(encodedCiphertext) as BufferSource,
  );
  return decoder.decode(plaintext);
}
