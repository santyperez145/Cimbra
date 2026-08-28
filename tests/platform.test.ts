import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyPrefix, createApiKey, decryptPlatformSecret, encryptPlatformSecret, hashApiKey, signWebhook, verifyApiKey, verifyWebhookSignature } from '../app/lib/platform/crypto.ts';
import { decodePageCursor, encodePageCursor, pageLimit, paginatedResponse } from '../app/lib/platform/pagination.ts';
import { isPrivateAddress, normalizeWebhookUrl } from '../app/lib/platform/webhook-url.ts';

process.env.CIMBRA_ENCRYPTION_KEY = '3ea72fc13c567057870342c6ebd34d88f58f6d80b1dba61c4be4e1c2f1406afb';

test('crea API keys opacas y sólo valida el hash correcto', async () => {
  const key = createApiKey();
  assert.equal(apiKeyPrefix(key.token), key.prefix);
  const hash = await hashApiKey(key.token);
  assert.equal(await verifyApiKey(key.token, hash), true);
  assert.equal(await verifyApiKey(`${key.token}x`, hash), false);
  assert.equal(apiKeyPrefix('cim_sk_test_invalid'), null);
});

test('cifra secretos de webhook con AES-GCM y detecta alteraciones', async () => {
  const encrypted = await encryptPlatformSecret('whsec_test_secret');
  assert.notEqual(encrypted, 'whsec_test_secret');
  assert.equal(await decryptPlatformSecret(encrypted), 'whsec_test_secret');
  const changed = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
  await assert.rejects(() => decryptPlatformSecret(changed));
});

test('firma timestamp y cuerpo de webhook con HMAC-SHA256', async () => {
  const signature = await signWebhook('whsec_test_secret', '1787941200', '{"id":"evt_1"}');
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.equal(await verifyWebhookSignature('whsec_test_secret', '1787941200', '{"id":"evt_1"}', signature), true);
  assert.equal(await verifyWebhookSignature('whsec_test_secret', '1787941201', '{"id":"evt_1"}', signature), false);
});

test('rechaza destinos privados, reservados o sin HTTPS', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.20.1.2', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1']) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(normalizeWebhookUrl('https://hooks.example.com/cimbra'), 'https://hooks.example.com/cimbra');
  assert.throws(() => normalizeWebhookUrl('http://hooks.example.com/cimbra'), /HTTPS/);
  assert.throws(() => normalizeWebhookUrl('https://127.0.0.1/cimbra'), /privada/);
  assert.throws(() => normalizeWebhookUrl('https://user:pass@hooks.example.com/cimbra'), /credenciales/);
});

test('pagina colecciones con cursores opacos y límites acotados', () => {
  const rows = [
    { id: '00000000-0000-4000-8000-000000000003', createdAt: '2026-08-28T12:00:00.000Z' },
    { id: '00000000-0000-4000-8000-000000000002', createdAt: '2026-08-28T11:00:00.000Z' },
  ];
  const page = paginatedResponse(rows, 1);
  assert.equal(page.data.length, 1);
  assert.equal(page.hasMore, true);
  assert.deepEqual(decodePageCursor(page.nextCursor), rows[0]);
  assert.deepEqual(decodePageCursor(encodePageCursor(rows[1])), rows[1]);
  assert.equal(decodePageCursor('invalid'), undefined);
  assert.equal(pageLimit('101'), null);
  assert.equal(pageLimit('25'), 25);
});
