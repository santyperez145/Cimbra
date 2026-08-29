import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyPrefix, createApiKey, decryptPlatformSecret, encryptPlatformSecret, hashApiKey, signWebhook, verifyApiKey, verifyWebhookSignature } from '../app/lib/platform/crypto.ts';
import { decodePageCursor, encodePageCursor, pageLimit, paginatedResponse } from '../app/lib/platform/pagination.ts';
import { isPrivateAddress, normalizeWebhookUrl } from '../app/lib/platform/webhook-url.ts';
import { versionedApi } from '../app/lib/platform/versioned-api.ts';
import { CAPABILITY_AVAILABILITY, PLATFORM_CAPABILITIES, PLATFORM_SUMMARY } from '../app/lib/platform/capabilities.ts';
import { matchReconciliationEntries } from '../app/lib/platform/reconciliation.ts';
import { systemAmountRisk } from '../app/lib/platform/risk-engine.ts';
import { csvObjects, CsvError } from '../app/lib/platform/csv.ts';
import { ACCESS_POLICY, ROLE_PROFILES, assignableRole, canManageRole, normalizeAccessEmail, roleCan, rolesFor } from '../app/lib/platform/access-policy.ts';
import { approvalActionType, approvalExpiryMinutes, approvalReason, canDecideApproval } from '../app/lib/platform/approval-policy.ts';
import { normalizeEvidenceLink, normalizeOperationalNote, normalizeWorkItemUpdate } from '../app/lib/platform/operations-input.ts';
import { normalizeRiskRuleInput, normalizeRiskSimulationSamples } from '../app/lib/platform/risk-input.ts';

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

test('la API v1 informa replay y política de reintento en headers', async () => {
  const replay = await versionedApi(new Request('https://api.test/api/v1/test'), () =>
    Response.json({ ok: true, replayed: true }));
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  const retry = await versionedApi(new Request('https://api.test/api/v1/test'), () =>
    Response.json({ error: 'Temporal' }, { status: 503 }));
  assert.equal(retry.headers.get('cimbra-should-retry'), 'true');
  const reject = await versionedApi(new Request('https://api.test/api/v1/test'), () =>
    Response.json({ error: 'Inválido' }, { status: 400 }));
  assert.equal(reject.headers.get('cimbra-should-retry'), 'false');
});

test('el catálogo sólo declara servicios propios y estados verificables', () => {
  assert.equal(PLATFORM_SUMMARY.owner, 'Cimbra');
  assert.equal(PLATFORM_SUMMARY.strategy, 'build_native');
  assert.equal(PLATFORM_SUMMARY.competitorDependency, false);
  assert.equal(new Set(PLATFORM_CAPABILITIES.map((item) => item.id)).size, PLATFORM_CAPABILITIES.length);
  assert.ok(PLATFORM_CAPABILITIES.length >= 15);
  for (const capability of PLATFORM_CAPABILITIES) {
    assert.equal(capability.delivery, 'cimbra_native');
    assert.ok(CAPABILITY_AVAILABILITY.includes(capability.availability));
    assert.ok(capability.features.length > 0);
    assert.ok(capability.interfaces.length > 0);
    assert.ok(capability.regulatoryBoundary.length > 20);
  }
});

test('la jerarquía RBAC protege owner, admins y emails de invitación', () => {
  assert.equal(normalizeAccessEmail('  Operador@Empresa.COM '), 'operador@empresa.com');
  assert.equal(normalizeAccessEmail('correo-invalido'), null);
  assert.equal(assignableRole('owner'), null);
  assert.equal(assignableRole('operator'), 'operator');
  assert.equal(canManageRole('owner', 'admin', 'viewer'), true);
  assert.equal(canManageRole('admin', 'admin', 'viewer'), false);
  assert.equal(canManageRole('admin', 'operator', 'admin'), false);
  assert.equal(canManageRole('admin', 'operator', 'viewer'), true);
  assert.equal(canManageRole('owner', 'owner', 'admin'), false);
});

test('una matriz canónica gobierna capacidades de API y consola', () => {
  assert.deepEqual(rolesFor('console.read'), ['owner', 'admin', 'operator', 'viewer']);
  assert.deepEqual(rolesFor('finance.write'), ['owner', 'admin', 'operator']);
  assert.deepEqual(rolesFor('credentials.manage'), ['owner', 'admin']);
  assert.deepEqual(rolesFor('approvals.policy.manage'), ['owner']);
  assert.equal(roleCan('owner', 'approvals.policy.manage'), true);
  assert.equal(roleCan('admin', 'approvals.policy.manage'), false);
  assert.equal(roleCan('admin', 'credentials.manage'), true);
  assert.equal(roleCan('operator', 'finance.write'), true);
  assert.equal(roleCan('operator', 'credentials.manage'), false);
  assert.equal(roleCan('viewer', 'console.read'), true);
  for (const capability of Object.keys(ACCESS_POLICY) as Array<keyof typeof ACCESS_POLICY>) {
    if (!['console.read', 'operations.read', 'approvals.read', 'security.manage_self'].includes(capability)) assert.equal(roleCan('viewer', capability), false, capability);
  }
  assert.equal(ROLE_PROFILES.viewer.posture, 'Sólo lectura');
});

test('la cola operativa valida cambios, SLA, comentarios y evidencia', () => {
  assert.deepEqual(normalizeWorkItemUpdate({ priority: 'critical', dueAt: '2026-08-30T12:00:00Z', escalated: true }), {
    priority: 'critical', dueAt: '2026-08-30T12:00:00.000Z', escalated: true,
  });
  assert.deepEqual(normalizeWorkItemUpdate({ assignedToUserId: null }), { assignedToUserId: null });
  assert.equal(normalizeWorkItemUpdate({ priority: 'urgent' }), null);
  assert.equal(normalizeWorkItemUpdate({}), null);
  assert.equal(normalizeOperationalNote({ body: '  Evidencia revisada  ' }), 'Evidencia revisada');
  assert.equal(normalizeOperationalNote({ body: 'x' }), null);
  assert.equal(normalizeEvidenceLink({ documentId: '00000000-0000-4000-8000-000000000001' }), '00000000-0000-4000-8000-000000000001');
});

test('maker/checker exige otro actor privilegiado con MFA y políticas acotadas', () => {
  assert.equal(approvalActionType('settlement.execute'), 'settlement.execute');
  assert.equal(approvalActionType('transfer.create'), 'transfer.create');
  assert.equal(approvalActionType('risk.case.resolve'), 'risk.case.resolve');
  assert.equal(approvalActionType('reconciliation.exception.resolve'), 'reconciliation.exception.resolve');
  assert.equal(approvalActionType('competitor.execute'), null);
  assert.equal(approvalExpiryMinutes(15), 15);
  assert.equal(approvalExpiryMinutes(10_081), null);
  assert.equal(approvalReason('  diferencia validada  ', true), 'diferencia validada');
  assert.equal(approvalReason('x', true), null);
  assert.equal(canDecideApproval({ actorRole: 'admin', actorId: 'checker', requesterId: 'maker', mfaEnabled: true }), true);
  assert.equal(canDecideApproval({ actorRole: 'owner', actorId: 'maker', requesterId: 'maker', mfaEnabled: true }), false);
  assert.equal(canDecideApproval({ actorRole: 'admin', actorId: 'checker', requesterId: 'maker', mfaEnabled: false }), false);
  assert.equal(canDecideApproval({ actorRole: 'operator', actorId: 'checker', requesterId: 'maker', mfaEnabled: true }), false);
});

test('las políticas de monto son regionales y explicables', () => {
  assert.deepEqual(systemAmountRisk(200_000_000n, 'ARS'), { scoreDelta: 61, forceReview: true, ruleId: 'sys_amount_high', reason: 'amount_high' });
  assert.deepEqual(systemAmountRisk(75_000_000n, 'ARS'), { scoreDelta: 25, forceReview: false, ruleId: 'sys_amount_elevated', reason: 'amount_elevated' });
  assert.equal(systemAmountRisk(999_999n, 'USD').scoreDelta, 0);
  assert.equal(systemAmountRisk(3_000_000n, 'USD').forceReview, true);
});

test('normaliza políticas versionables y acota las muestras de simulación', () => {
  assert.deepEqual(normalizeRiskRuleInput({ name: '  Cash-out alto  ', kind: 'amount_threshold', operationType: 'cash_out',
    scoreDelta: 60, action: 'review', priority: 25, configuration: { threshold: '30000.00', currency: 'usd' } }), {
    name: 'Cash-out alto', kind: 'amount_threshold', operationType: 'cash_out', scoreDelta: 60, action: 'review', priority: 25,
    configuration: { thresholdMinor: '3000000', currency: 'USD' },
  });
  assert.equal(normalizeRiskRuleInput({ name: 'x', kind: 'velocity_count' }), null);
  const samples = normalizeRiskSimulationSamples([
    { operationType: 'transfer', amount: '1250.50', currency: 'ARS', counterparty: 'Proveedor QA' },
    { operationType: 'cash_out', amount: '10', currency: 'CLP', counterparty: 'Comercio QA' },
  ]);
  assert.equal(samples?.[0].amountMinor, 125050n);
  assert.equal(samples?.[1].amountMinor, 10n);
  assert.equal(normalizeRiskSimulationSamples([]), null);
  assert.equal(normalizeRiskSimulationSamples(Array.from({ length: 51 }, () => ({ operationType: 'transfer', amount: '1', currency: 'ARS', counterparty: 'QA' }))), null);
});

test('la conciliación detecta matches, diferencias y faltantes en ambos lados', () => {
  const items = matchReconciliationEntries([
    { id: 'tx-1', amountMinor: '10000' }, { id: 'tx-2', amountMinor: '-5000' }, { id: 'tx-3', amountMinor: '2500' },
  ], [
    { externalReference: 'ext-1', transactionId: 'tx-1', actualMinor: 10000n },
    { externalReference: 'ext-2', transactionId: 'tx-2', actualMinor: -4500n },
    { externalReference: 'ext-4', transactionId: 'tx-unknown', actualMinor: 700n },
  ]);
  assert.deepEqual(items.map((item) => item.status), ['matched', 'mismatch', 'missing_internal', 'missing_external']);
  assert.equal(items[1].differenceMinor, 500n);
  assert.equal(items[2].differenceMinor, 700n);
  assert.equal(items[3].transactionId, 'tx-3');
});

test('el importador CSV conserva comas escapadas y exige el contrato canónico', () => {
  const rows = csvObjects('\uFEFFexternal_reference,transaction_id,direction,amount\r\n"BANCO,001",,credit,1250.50\r\nBANCO-002,,debit,500');
  assert.deepEqual(rows, [
    { external_reference: 'BANCO,001', transaction_id: '', direction: 'credit', amount: '1250.50' },
    { external_reference: 'BANCO-002', transaction_id: '', direction: 'debit', amount: '500' },
  ]);
  assert.throws(() => csvObjects('reference,direction,amount\nA,credit,1'), CsvError);
  assert.throws(() => csvObjects('external_reference,direction,amount\n"A,credit,1'), /sin cierre/);
});
