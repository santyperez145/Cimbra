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

test('el SDK pagina el historial de auditoría sin truncarlo', async () => {
  const urls: string[] = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', fetch: async (input) => {
    const url = String(input); urls.push(url);
    if (url.includes('cursor=audit_2')) return Response.json({ data: [{ id: 'evt_2', action: 'dispute.resolve_lost' }], hasMore: false, nextCursor: null });
    return Response.json({ data: [{ id: 'evt_1', action: 'dispute.created' }], hasMore: true, nextCursor: 'audit_2' });
  } });
  const actions: string[] = [];
  for await (const event of client.events.listAll({ limit: 1 })) actions.push(event.action);
  assert.deepEqual(actions, ['dispute.created', 'dispute.resolve_lost']);
  assert.deepEqual(urls, [
    'https://api.test/api/v1/events?limit=1',
    'https://api.test/api/v1/events?limit=1&cursor=audit_2',
  ]);
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

test('el SDK cablea book transfers, reversas y statements paginados', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0,
    fetch: async (input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
      if (url.includes('/statement')) return Response.json({ account: { id: 'acc_1', accountReference: 'AR-ARS-1', currency: 'ARS', status: 'active' },
        period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', openingBalanceMinor: '0', openingBalance: 0,
          closingBalanceMinor: '1000', closingBalance: 10 }, data: [], hasMore: false, nextCursor: null });
      if (url.endsWith('/reverse')) return Response.json({ ok: true, transfer: { id: 'bt_1', status: 'reversed' },
        reversal: { id: 'tx_rev_1' }, replayed: false }, { status: 201 });
      return Response.json({ ok: true, requiresApproval: false, transfer: { id: 'bt_1', status: 'settled' }, replayed: false }, { status: 201 });
    } });
  const created = await client.bookTransfers.create({ externalReference: 'BT-001', sourceAccountId: 'acc_1',
    destinationAccountId: 'acc_2', description: 'Distribución', amount: '10.00', currency: 'ARS' });
  if (!created.data.requiresApproval) await client.bookTransfers.reverse(created.data.transfer.id);
  await client.accounts.statement('acc_1', { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', limit: 50 });
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/book-transfers',
    'POST https://api.test/api/v1/book-transfers/bt_1/reverse',
    'GET https://api.test/api/v1/accounts/acc_1/statement?from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z&limit=50',
  ]);
  assert.match(calls[0].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.match(calls[1].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.equal(calls[2].idempotencyKey, null);
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

test('el SDK representa resoluciones operativas pendientes de checker', async () => {
  const calls: string[] = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input) => {
    calls.push(String(input));
    const risk = String(input).includes('/risk/cases/');
    return Response.json({ ok: true, requiresApproval: true, replayed: false, deduplicated: false,
      approval: { id: risk ? 'approval_risk' : 'approval_reconciliation',
        actionType: risk ? 'risk.case.resolve' : 'reconciliation.exception.resolve',
        resourceType: risk ? 'risk_case' : 'reconciliation_exception', resourceId: risk ? 'case_1' : 'exception_1', status: 'pending' } },
    { status: 202 });
  } });
  const risk = await client.risk.resolveCase('case_1', { resolution: 'approved', note: 'Evidencia validada.' });
  const reconciliation = await client.reconciliation.resolveException('exception_1', { resolution: 'accepted', note: 'Diferencia validada.' });
  assert.equal(risk.data.requiresApproval && risk.data.approval.actionType, 'risk.case.resolve');
  assert.equal(reconciliation.data.requiresApproval && reconciliation.data.approval.actionType, 'reconciliation.exception.resolve');
  assert.deepEqual(calls, [
    'https://api.test/api/v1/risk/cases/case_1/resolve',
    'https://api.test/api/v1/reconciliation/exceptions/exception_1/resolve',
  ]);
});

test('el SDK abre, recupera y transiciona disputas nativas', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (method === 'GET') return Response.json({ data: { dispute: { id: 'dispute_1', status: 'opened' }, events: [] } });
    if (url.endsWith('/events')) return Response.json({ ok: true, requiresApproval: false, replayed: false, dispute: { id: 'dispute_1', status: 'under_review' } });
    return Response.json({ ok: true, replayed: false, dispute: { id: 'dispute_1', status: 'opened' } }, { status: 201 });
  } });
  const opened = await client.disputes.create({ transactionId: 'transaction_1', reason: 'service_not_received',
    description: 'Servicio no entregado', amount: '25.00', currency: 'ARS', provisionalCreditRequested: true });
  await client.disputes.retrieve(opened.data.dispute.id);
  await client.disputes.transition(opened.data.dispute.id, { event: 'start_review', note: 'Evidencia validada.' });
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/disputes', 'GET https://api.test/api/v1/disputes/dispute_1',
    'POST https://api.test/api/v1/disputes/dispute_1/events',
  ]);
  assert.match(calls[0].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.equal(calls[1].idempotencyKey, null);
  assert.match(calls[2].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
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

test('el SDK cubre versionado, simulación y promoción de políticas de riesgo', async () => {
  const calls: Array<{ url: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); calls.push({ url, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (url.endsWith('/versions')) return Response.json({ ok: true, replayed: false, rule: { id: 'rule_2', familyId: 'rule_1', version: 2, deployment: 'challenger' } }, { status: 201 });
    if (url.endsWith('/simulations')) return Response.json({ ok: true, replayed: false, simulation: { id: 'sim_1', candidateRuleId: 'rule_2', sampleCount: 1, deltaSummary: { decisionsChanged: 1 } } }, { status: 201 });
    return Response.json({ ok: true, replayed: false, promotion: { id: 'promotion_1', ruleId: 'rule_2', previousChampionId: 'rule_1', familyId: 'rule_1', version: 2 } });
  } });
  const input = { name: 'Versión 2', kind: 'counterparty_match' as const, operationType: 'transfer' as const,
    scoreDelta: 80, action: 'decline' as const, configuration: { pattern: 'sensible' } };
  const version = await client.risk.createRuleVersion('rule_1', input);
  const simulation = await client.risk.simulate({ candidateRuleId: version.data.rule.id,
    samples: [{ operationType: 'transfer', amount: '100.00', currency: 'ARS', counterparty: 'Comercio sensible' }] });
  const promotion = await client.risk.promoteRule(version.data.rule.id);
  assert.equal(simulation.data.simulation.deltaSummary.decisionsChanged, 1);
  assert.equal(promotion.data.promotion.previousChampionId, 'rule_1');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.test/api/v1/risk/rules/rule_1/versions',
    'https://api.test/api/v1/risk/simulations',
    'https://api.test/api/v1/risk/rules/rule_2/promote',
  ]);
  for (const call of calls) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK cablea señales, listas tenant y resultados confirmados sin exponer referencias', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null; body: Record<string, unknown> }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ url: String(input), method: init?.method ?? 'GET', idempotencyKey: new Headers(init?.headers).get('idempotency-key'), body });
    if (String(input).endsWith('/risk/lists')) return Response.json({ ok: true, replayed: false, entry: { id: 'list_1', subjectPreview: 'devi••••e-42', category: 'watch', status: 'active' } }, { status: 201 });
    if (String(input).endsWith('/outcomes')) return Response.json({ ok: true, replayed: false, outcome: { id: 'outcome_1', label: 'fraud', fraudType: 'account_takeover', lossAmountMinor: '1000', currency: 'ARS' } }, { status: 201 });
    if ((init?.method ?? 'GET') === 'DELETE') return Response.json({ ok: true, id: 'list_1', status: 'disabled' });
    return Response.json({ ok: true, requiresApproval: false, replayed: false, transaction: { id: 'tx_1' } }, { status: 201 });
  } });
  await client.transfers.create({ counterparty: 'Proveedor', description: 'Pago', amount: '10.00', currency: 'ARS',
    signals: { deviceReference: 'device-42', identityReference: 'customer-9', deviceTrust: 'suspicious' } });
  await client.risk.createListEntry({ subjectType: 'device', subjectValue: 'device-42', category: 'watch', reason: 'Señal interna' });
  await client.risk.reportOutcome('evaluation_1', { label: 'fraud', fraudType: 'account_takeover', lossAmount: '10.00', currency: 'ARS' });
  await client.risk.disableListEntry('list_1');
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/transfers', 'POST https://api.test/api/v1/risk/lists',
    'POST https://api.test/api/v1/risk/evaluations/evaluation_1/outcomes', 'DELETE https://api.test/api/v1/risk/lists/list_1',
  ]);
  assert.deepEqual((calls[0].body.signals as Record<string, unknown>), { deviceReference: 'device-42', identityReference: 'customer-9', deviceTrust: 'suspicious' });
  for (const call of calls.slice(0, 3)) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.equal(calls[3].idempotencyKey, null);
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
  await client.operations.addNote('dispute', 'dispute_1', 'Evidencia de disputa');
  assert.deepEqual(calls.map(({ url, method }) => `${method} ${url}`), [
    'GET https://api.test/api/v1/operations/work-items',
    'PATCH https://api.test/api/v1/operations/work-items/risk-case/case_1',
    'POST https://api.test/api/v1/operations/work-items/risk-case/case_1/notes',
    'POST https://api.test/api/v1/operations/work-items/reconciliation-exception/exception_1/evidence',
    'POST https://api.test/api/v1/operations/work-items/dispute/dispute_1/notes',
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

test('el SDK cablea billers, obligaciones, pagos, reversas y mandatos con rutas e idempotencia canónicas', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (url.endsWith('/obligations')) return Response.json({ ok: true, replayed: false, obligation: { id: 'obligation_1' } }, { status: 201 });
    if (url.endsWith('/reverse')) return Response.json({ ok: true, replayed: false, order: { id: 'order_1', status: 'reversed' } });
    if (url.includes('/recurring-mandates/') && url.endsWith('/status')) return Response.json({ ok: true, replayed: false, mandate: { id: 'mandate_1', status: 'paused' } });
    if (url.endsWith('/recurring-mandates')) return Response.json({ ok: true, replayed: false, mandate: { id: 'mandate_1', status: 'active' } }, { status: 201 });
    if (url.endsWith('/bill-payments')) return Response.json({ ok: true, replayed: false, order: { id: 'order_1', status: 'settled' } }, { status: 201 });
    return Response.json({ ok: true, replayed: false, biller: { id: 'biller_1', status: 'active' } }, { status: 201 });
  } });
  const biller = await client.billers.create({ code: 'ENERGIA_AR', name: 'Energía Regional', country: 'AR', category: 'utilities',
    serviceType: 'bill_payment', currency: 'ARS', amountMode: 'exact' });
  const debt = await client.billers.createObligation(biller.data.biller.id, { externalReference: 'INV-001', subscriberReference: 'CLIENTE-001234',
    amount: '100.00', dueAt: '2026-09-10T12:00:00.000Z', description: 'Servicio' });
  const paid = await client.billPayments.create({ accountId: 'account_1', billerId: biller.data.biller.id, obligationId: debt.data.obligation.id });
  await client.billPayments.reverse(paid.data.order.id);
  const mandate = await client.recurringMandates.create({ accountId: 'account_1', billerId: biller.data.biller.id,
    subscriberReference: 'CLIENTE-001234', frequency: 'monthly', amountLimit: '500.00', consentReference: 'CONSENT-001',
    consentedAt: '2026-08-30T12:00:00.000Z', nextChargeAt: '2026-09-30T12:00:00.000Z' });
  await client.recurringMandates.pause(mandate.data.mandate.id);
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/billers', 'POST https://api.test/api/v1/billers/biller_1/obligations',
    'POST https://api.test/api/v1/bill-payments', 'POST https://api.test/api/v1/bill-payments/order_1/reverse',
    'POST https://api.test/api/v1/recurring-mandates', 'POST https://api.test/api/v1/recurring-mandates/mandate_1/status',
  ]);
  for (const call of calls) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK orquesta KYC/KYB por S2S y excluye la decisión humana', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null; body: Record<string, unknown> }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key'), body });
    if (url.endsWith('/due-diligence')) return Response.json({ data: { policy: {}, metrics: {}, cases: [], customers: [], documents: [] } });
    if (method === 'GET') return Response.json({ data: { id: 'case_1', kind: 'kyb', status: 'draft', parties: [], checks: [], events: [] } });
    if (url.endsWith('/parties')) return Response.json({ ok: true, replayed: false, party: { id: 'party_1' } }, { status: 201 });
    if (url.endsWith('/checks')) return Response.json({ ok: true, replayed: false, check: { id: 'check_1' } }, { status: 201 });
    return Response.json({ ok: true, replayed: false, case: { id: 'case_1', kind: 'kyb', status: url.endsWith('/submit') ? 'in_review' : url.endsWith('/cancel') ? 'cancelled' : 'draft' } }, { status: url.endsWith('/cases') ? 201 : 200 });
  } });
  await client.dueDiligence.state();
  await client.dueDiligence.retrieve('case/unsafe');
  await client.dueDiligence.create({ customerId: 'customer_1', expiresInDays: 90 });
  await client.dueDiligence.addParty('case_1', { role: 'beneficial_owner', name: 'Ana Sur', taxId: '20123456789', ownershipPercentage: 25 });
  await client.dueDiligence.recordCheck('case_1', { checkType: 'sanctions', source: 'official_registry', status: 'passed', resultCode: 'no_match', note: 'Consulta directa.' });
  await client.dueDiligence.submit('case_1');
  await client.dueDiligence.cancel('case_1', 'Expediente duplicado.');
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'GET https://api.test/api/v1/due-diligence',
    'GET https://api.test/api/v1/due-diligence/cases/case%2Funsafe',
    'POST https://api.test/api/v1/due-diligence/cases',
    'POST https://api.test/api/v1/due-diligence/cases/case_1/parties',
    'POST https://api.test/api/v1/due-diligence/cases/case_1/checks',
    'POST https://api.test/api/v1/due-diligence/cases/case_1/submit',
    'POST https://api.test/api/v1/due-diligence/cases/case_1/cancel',
  ]);
  assert.equal(calls[0].idempotencyKey, null); assert.equal(calls[1].idempotencyKey, null);
  for (const call of calls.slice(2)) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.deepEqual(calls[4].body, { checkType: 'sanctions', source: 'official_registry', status: 'passed', resultCode: 'no_match', note: 'Consulta directa.' });
  assert.equal('decide' in client.dueDiligence, false);
});

test('el SDK cubre el lifecycle de step-up sin exponer secretos en lecturas', async () => {
  const calls: Array<{ method: string; url: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    calls.push({ method, url, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (method === 'GET') return Response.json({ data: [{ id: 'challenge_1', evaluationId: 'evaluation_1', status: 'pending' }] });
    if (url.endsWith('/verify')) return Response.json({ ok: true, replayed: false, verified: true,
      challenge: { id: 'challenge_1', evaluationId: 'evaluation_1', status: 'verified' },
      attempt: { id: 'attempt_1', attemptNumber: 1, result: 'matched' } });
    return Response.json({ ok: true, replayed: false, credential: '123456',
      challenge: { id: 'challenge_1', evaluationId: 'evaluation_1', status: 'pending' } }, { status: 201 });
  } });
  await client.risk.listStepUpChallenges('evaluation_1');
  const created = await client.risk.createStepUpChallenge('evaluation_1', { expiresInSeconds: 300, maxAttempts: 5 });
  await client.risk.verifyStepUpChallenge('evaluation_1', created.data.challenge.id, { credential: created.data.credential! });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    'GET https://api.test/api/v1/risk/evaluations/evaluation_1/step-up-challenges',
    'POST https://api.test/api/v1/risk/evaluations/evaluation_1/step-up-challenges',
    'POST https://api.test/api/v1/risk/evaluations/evaluation_1/step-up-challenges/challenge_1/verify',
  ]);
  assert.equal(calls[0].idempotencyKey, null);
  assert.match(calls[1].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.match(calls[2].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK cablea programas, emisión, lifecycle y controles de tarjetas con idempotencia', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    if (url.endsWith('/card-programs')) return Response.json({ ok: true, replayed: false, program: { id: 'program_1', name: 'Débito ARS' } }, { status: 201 });
    if (url.endsWith('/cards')) return Response.json({ ok: true, replayed: false, card: { id: 'card_1', status: 'created' } }, { status: 201 });
    if (url.endsWith('/lifecycle')) return Response.json({ ok: true, replayed: false, event: { id: 'event_1', toStatus: 'active' } });
    return Response.json({ ok: true, replayed: false, controls: { id: 'controls_2', version: 2 } });
  } });
  const program = await client.cardPrograms.create({ name: 'Débito ARS', product: 'debit', formats: ['physical'], defaultCurrency: 'ARS' });
  const card = await client.cards.create({ accountId: 'account_1', programId: program.data.program.id, format: 'physical' });
  await client.cards.transition(card.data.card.id, { status: 'active', reason: 'activation' });
  await client.cards.updateControls(card.data.card.id, { currency: 'ARS', perTransactionLimit: '1000', dailyLimit: '5000',
    monthlyLimit: '30000', allowedChannels: ['chip', 'contactless'], allowedMccs: [], blockedMccs: ['7995'], status: 'active' });
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/card-programs', 'POST https://api.test/api/v1/cards',
    'POST https://api.test/api/v1/cards/card_1/lifecycle', 'PATCH https://api.test/api/v1/cards/card_1/controls',
  ]);
  for (const call of calls) assert.match(call.idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
});

test('el SDK cablea beneficiarios, lotes asíncronos y archivo de resultados de payouts', async () => {
  const calls: Array<{ url: string; method: string; idempotencyKey: string | null; body: unknown }> = [];
  const client = new Cimbra({ apiKey: 'cim_sk_test_example', baseUrl: 'https://api.test', maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method, idempotencyKey: new Headers(init?.headers).get('idempotency-key'), body });
    if (url.endsWith('/result')) return new Response('"item_reference","status"\r\n"item_1","settled"\r\n', { headers: { 'Content-Type': 'text/csv' } });
    if (url.endsWith('/status')) return Response.json({ ok: true, replayed: false, beneficiary: { id: 'beneficiary_1', status: 'suspended' } });
    if (url.endsWith('/submit')) return Response.json({ ok: true, replayed: false, requiresApproval: false, approval: null,
      batch: { id: 'batch_1', status: 'processing', items: [] } }, { status: 202 });
    if (url.endsWith('/cancel')) return Response.json({ ok: true, replayed: false, batch: { id: 'batch_1', status: 'cancelled', items: [] } });
    if (url.endsWith('/payout-beneficiaries') && method === 'POST') return Response.json({ ok: true, replayed: false,
      beneficiary: { id: 'beneficiary_1', status: 'active', destinationLast4: '3456' } }, { status: 201 });
    if (url.endsWith('/payout-batches') && method === 'POST') return Response.json({ ok: true, replayed: false,
      batch: { id: 'batch_1', status: 'draft', items: [] } }, { status: 201 });
    return Response.json({ data: [] });
  } });
  const beneficiary = await client.payoutBeneficiaries.create({ externalReference: 'supplier_1', name: 'Proveedor Uno', entityType: 'business',
    country: 'AR', currency: 'ARS', destinationType: 'alias', destination: 'proveedor.uno' });
  await client.payoutBeneficiaries.list();
  await client.payoutBeneficiaries.setStatus(beneficiary.data.beneficiary.id, 'suspend');
  const batch = await client.payoutBatches.create({ sourceAccountId: 'account_1', externalReference: 'payroll_1', description: 'Lote QA', currency: 'ARS',
    items: [{ externalReference: 'item_1', beneficiaryId: beneficiary.data.beneficiary.id, amount: '25.00', description: 'Factura 1' }] });
  await client.payoutBatches.list();
  await client.payoutBatches.retrieve(batch.data.batch.id);
  await client.payoutBatches.submit(batch.data.batch.id);
  await client.payoutBatches.cancel(batch.data.batch.id);
  const result = await client.payoutBatches.resultCsv(batch.data.batch.id);
  assert.match(result.data, /item_1/);
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
    'POST https://api.test/api/v1/payout-beneficiaries',
    'GET https://api.test/api/v1/payout-beneficiaries',
    'POST https://api.test/api/v1/payout-beneficiaries/beneficiary_1/status',
    'POST https://api.test/api/v1/payout-batches',
    'GET https://api.test/api/v1/payout-batches',
    'GET https://api.test/api/v1/payout-batches/batch_1',
    'POST https://api.test/api/v1/payout-batches/batch_1/submit',
    'POST https://api.test/api/v1/payout-batches/batch_1/cancel',
    'GET https://api.test/api/v1/payout-batches/batch_1/result',
  ]);
  assert.equal(calls[1].idempotencyKey, null); assert.equal(calls[4].idempotencyKey, null);
  assert.equal(calls[5].idempotencyKey, null); assert.equal(calls[8].idempotencyKey, null);
  for (const index of [0, 2, 3, 6, 7]) assert.match(calls[index].idempotencyKey ?? '', /^idem_[a-f0-9]{32}$/);
  assert.deepEqual(calls[6].body, {});
});
