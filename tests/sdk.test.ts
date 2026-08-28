import assert from 'node:assert/strict';
import test from 'node:test';
import { Cimbra, CimbraApiError, CimbraWebhookSignatureError, constructWebhookEvent, verifyWebhookSignature } from '../packages/sdk/src/index.ts';

test('el SDK reintenta escrituras seguras conservando request e idempotency IDs', async () => {
  const calls: Array<{ requestId: string | null; idempotencyKey: string | null }> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ requestId: headers.get('x-request-id'), idempotencyKey: headers.get('idempotency-key') });
    if (calls.length === 1) {
      return Response.json({ error: { type: 'cimbra_api_error', code: 'internal_error', message: 'Temporal', requestId: 'req_server' } }, { status: 500 });
    }
    return Response.json({ ok: true, replayed: false, customer: { id: 'cus_1' } }, { status: 201, headers: { 'X-Request-Id': 'req_server' } });
  };
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', fetch: fetcher, sleep: async () => undefined });
  const result = await client.customers.create({ name: 'Comercio Sur', country: 'AR', taxId: '30712345678' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.match(calls[0].requestId ?? '', /^req_[a-f0-9]{32}$/);
  assert.match(calls[0].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.equal(result.requestId, 'req_server');
  assert.equal(result.data.customer.id, 'cus_1');
});

test('el SDK expone errores tipados y no reintenta errores de validación', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return Response.json({
      error: { type: 'cimbra_api_error', code: 'invalid_request', message: 'Payload inválido.', requestId: 'req_validation' },
    }, { status: 400, headers: { 'X-Request-Id': 'req_validation' } });
  };
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', fetch: fetcher, sleep: async () => undefined });

  await assert.rejects(
    client.accounts.create({ customerId: '', currency: 'ARS', country: 'AR' }),
    (error: unknown) => {
      assert.ok(error instanceof CimbraApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_request');
      assert.equal(error.requestId, 'req_validation');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('el SDK lista y recupera recursos usando cursores y rutas versionadas', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return Response.json({ data: [], hasMore: false, nextCursor: null });
    return Response.json({ id: '00000000-0000-4000-8000-000000000001', name: 'Comercio Sur' });
  };
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', fetch: fetcher });
  await client.customers.list({ limit: 10, cursor: 'next_page' });
  const customer = await client.customers.retrieve('00000000-0000-4000-8000-000000000001');
  assert.equal(urls[0], 'https://api.test/api/v1/customers?limit=10&cursor=next_page');
  assert.equal(urls[1], 'https://api.test/api/v1/customers/00000000-0000-4000-8000-000000000001');
  assert.equal(customer.data.name, 'Comercio Sur');
});

test('el SDK auto-pagina bajo demanda y respeta la señal de retry del servidor', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('cursor=page_2')) return Response.json({ data: [{ id: 'cus_2' }], hasMore: false, nextCursor: null });
    return Response.json({ data: [{ id: 'cus_1' }], hasMore: true, nextCursor: 'page_2' });
  };
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', fetch: fetcher });
  const ids: string[] = [];
  for await (const customer of client.customers.listAll({ limit: 1 })) ids.push(customer.id);
  assert.deepEqual(ids, ['cus_1', 'cus_2']);
  assert.equal(urls[1], 'https://api.test/api/v1/customers?limit=1&cursor=page_2');

  let retryCalls = 0;
  const noRetry = new Cimbra({
    apiKey: 'cim_sk_test_example', maxRetries: 2, sleep: async () => undefined,
    fetch: async () => {
      retryCalls += 1;
      return Response.json({ error: 'No reintentar' }, { status: 500, headers: { 'Cimbra-Should-Retry': 'false' } });
    },
  });
  await assert.rejects(noRetry.ledger.retrieve(), CimbraApiError);
  assert.equal(retryCalls, 1);
});

test('el SDK verifica firma, timestamp, cuerpo crudo y antigüedad del webhook', async () => {
  const secret = 'whsec_test_secret';
  const timestamp = '1787941200';
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.created', createdAt: '2026-08-28T13:00:00.000Z', data: { id: 'cus_1' } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const header = `t=${timestamp},v1=${signature}`;
  const now = new Date(Number(timestamp) * 1000);

  assert.equal(await verifyWebhookSignature({ payload, signature: header, timestamp, secret, now }), true);
  const event = await constructWebhookEvent<{ id: string }>({ payload, signature: header, timestamp, secret, now });
  assert.equal(event.data.id, 'cus_1');
  await assert.rejects(
    verifyWebhookSignature({ payload: `${payload} `, signature: header, timestamp, secret, now }),
    CimbraWebhookSignatureError,
  );
  await assert.rejects(
    verifyWebhookSignature({ payload, signature: header, timestamp, secret, now: new Date(now.getTime() + 301_000) }),
    CimbraWebhookSignatureError,
  );
});
