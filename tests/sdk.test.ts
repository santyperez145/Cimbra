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

test('el SDK crea payments regionales con idempotencia automática', async () => {
  let requestUrl = '';
  let idempotencyKey = '';
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', fetch: async (input, init) => {
    requestUrl = String(input);
    idempotencyKey = new Headers(init?.headers).get('idempotency-key') ?? '';
    return Response.json({ ok: true, replayed: false, payment: { id: 'pay_1', amountMinor: '10000' } }, { status: 201 });
  } });
  const result = await client.payments.create({ accountId: 'acc_1', direction: 'cash_in', counterparty: 'Sponsor', description: 'Ingreso', amount: '100.00', currency: 'ARS' });
  assert.equal(requestUrl, 'https://api.test/api/v1/payments');
  assert.match(idempotencyKey, /^idem_[a-f0-9]{32}$/);
  assert.equal(result.data.payment.id, 'pay_1');
});

test('el SDK representa transferencias pendientes de aprobación humana', async () => {
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async () =>
    Response.json({ ok: true, requiresApproval: true, replayed: false, deduplicated: false,
      approval: { id: 'approval_1', actionType: 'transfer.create', resourceType: 'transfer', resourceId: 'transfer_1', status: 'pending' } },
    { status: 202 }) });
  const result = await client.transfers.create({ counterparty: 'Proveedor', description: 'Pago protegido', amount: '25.00', currency: 'ARS' });
  assert.equal(result.data.requiresApproval, true);
  if (result.data.requiresApproval) assert.equal(result.data.approval.actionType, 'transfer.create');
});

test('el SDK expone el catálogo de servicios nativos de Cimbra', async () => {
  let requestUrl = '';
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input) => {
    requestUrl = String(input);
    return Response.json({ data: [{ id: 'financial-core', availability: 'sandbox', delivery: 'cimbra_native' }], meta: { owner: 'Cimbra', strategy: 'build_native', competitorDependency: false, networkBoundary: 'direct_regulated_rails_only' } });
  } });
  const result = await client.capabilities.list();
  assert.equal(requestUrl, 'https://api.test/api/v1/capabilities');
  assert.equal(result.data.meta.competitorDependency, false);
  assert.equal(result.data.data[0].id, 'financial-core');
});

test('el SDK crea reglas de riesgo y conciliaciones con idempotencia', async () => {
  const calls: Array<{ url: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    calls.push({ url: String(input), idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (String(input).endsWith('/risk/rules')) return Response.json({ ok: true, replayed: false, rule: { id: 'rule_1', status: 'active' } }, { status: 201 });
    return Response.json({ ok: true, replayed: false, run: { id: 'run_1', status: 'completed' } }, { status: 201 });
  } });
  await client.risk.createRule({ name: 'Monto alto USD', kind: 'amount_threshold', operationType: 'cash_out', scoreDelta: 50,
    action: 'review', configuration: { threshold: '30000.00', currency: 'USD' } });
  await client.reconciliation.createRun({ name: 'Cierre diario', source: 'bank', currency: 'ARS',
    periodStart: '2026-08-27T00:00:00.000Z', periodEnd: '2026-08-28T00:00:00.000Z', entries: [] });
  assert.deepEqual(calls.map((call) => call.url), ['https://api.test/api/v1/risk/rules', 'https://api.test/api/v1/reconciliation/runs']);
  for (const call of calls) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK administra la cola operativa con rutas e idempotencia canónicas', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if ((init?.method ?? 'GET') === 'GET') return Response.json({ data: { workItems: [], members: [], documents: [], notes: [], evidence: [] } });
    if (String(input).endsWith('/notes')) return Response.json({ ok: true, replayed: false, note: { id: 'note_1' } }, { status: 201 });
    if (String(input).endsWith('/evidence')) return Response.json({ ok: true, replayed: false, evidence: { id: 'evidence_1' } }, { status: 201 });
    return Response.json({ ok: true, replayed: false, workItem: { id: 'case_1', type: 'risk_case', status: 'open' } });
  } });
  await client.operations.list();
  await client.operations.update('risk_case', 'case_1', { priority: 'critical', escalated: true });
  await client.operations.addNote('risk_case', 'case_1', 'Revisión prioritaria');
  await client.operations.linkEvidence('reconciliation_exception', 'exception_1', 'document_1');
  assert.deepEqual(calls.map(({ url, method }) => `${method} ${url}`), [
    'GET https://api.test/api/v1/operations/work-items',
    'PATCH https://api.test/api/v1/operations/work-items/risk-case/case_1',
    'POST https://api.test/api/v1/operations/work-items/risk-case/case_1/notes',
    'POST https://api.test/api/v1/operations/work-items/reconciliation-exception/exception_1/evidence',
  ]);
  for (const call of calls.slice(1)) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK importa CSV, ejecuta settlements y consulta aprobaciones', async () => {
  const calls: Array<{ url: string; contentType: string | null; body: BodyInit | null | undefined }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    calls.push({ url: String(input), contentType: new Headers(init?.headers).get('content-type'), body: init?.body });
    if (String(input).endsWith('/reconciliation/imports')) return Response.json({ ok: true, replayed: false,
      run: { id: 'run_1', status: 'completed' }, import: { fileName: 'bank.csv', fileSha256: 'sha', rowCount: 1 } }, { status: 201 });
    if (String(input).endsWith('/settlements')) return Response.json({ ok: true, replayed: false, cycle: { id: 'cycle_1', status: 'ready' } }, { status: 201 });
    if (String(input).endsWith('/approvals')) return Response.json({ data: [{ id: 'approval_1', status: 'pending' }] });
    return Response.json({ ok: true, replayed: false, cycle: { id: 'cycle_1', status: 'settled' } });
  } });
  await client.reconciliation.importCsv({ name: 'Banco', source: 'bank', currency: 'ARS', periodStart: '2026-08-27T00:00:00.000Z',
    periodEnd: '2026-08-28T00:00:00.000Z', fileName: 'bank.csv', csv: 'external_reference,transaction_id,direction,amount\nEXT-1,,credit,10.00' });
  await client.settlements.create({ reconciliationRunId: '00000000-0000-4000-8000-000000000001', name: 'Liquidación banco' });
  await client.settlements.execute('cycle_1');
  await client.approvals.list();
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.test/api/v1/reconciliation/imports', 'https://api.test/api/v1/settlements', 'https://api.test/api/v1/settlements/cycle_1/execute',
    'https://api.test/api/v1/approvals',
  ]);
  assert.equal(calls[0].contentType, null);
  assert.ok(calls[0].body instanceof FormData);
  assert.equal((calls[0].body as FormData).get('name'), 'Banco');
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
