import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyEnvironment, apiKeyPrefix, createApiKey, decryptPlatformSecret, encryptPlatformSecret, hashApiKey, signWebhook, verifyApiKey, verifyWebhookSignature } from '../app/lib/platform/crypto.ts';
import { decodePageCursor, encodePageCursor, pageLimit, paginatedResponse } from '../app/lib/platform/pagination.ts';
import { isPrivateAddress, normalizeWebhookUrl } from '../app/lib/platform/webhook-url.ts';
import { versionedApi } from '../app/lib/platform/versioned-api.ts';
import { CAPABILITY_AVAILABILITY, PLATFORM_CAPABILITIES, PLATFORM_SUMMARY } from '../app/lib/platform/capabilities.ts';
import { capitalPlanSnapshot, composeLeadMessage, isForbiddenCapitalSpend, normalizeDemoIntent } from '../app/lib/platform/capital-plan.ts';
import { isPlatformOperatorEmail, platformOperatorEmails, platformOperatorProvisioned } from '../app/lib/platform/platform-operators.ts';
import { SERVICE_CATALOG, serviceTopology } from '../app/lib/platform/service-catalog.ts';
import { normalizeLeadStatusInput, normalizeOrganizationPatch, normalizeSupportCaseInput, normalizeSupportMessageInput } from '../app/lib/platform/support-input.ts';
import { buildInvestorEvidence } from '../app/lib/platform/investor-evidence.ts';
import { COMPETITOR_REFERENCES, evaluateLiveReadiness, PLATFORM_PRODUCTS, requireLiveApiKeysEnabled, requireSandboxLedgerOrCertifiedRail } from '../app/lib/platform/live-readiness.ts';
import { dispatchOfficialRail, materializeOfficialRails, OFFICIAL_RAIL_ADAPTERS, OFFICIAL_RAIL_CONNECTIONS, requiredRailIdsForProduct } from '../app/lib/platform/official-rails.ts';
import { PlatformRailError } from '../app/lib/platform/operating-mode.ts';
import {
  assertSponsorBankTransition, dueDiligenceProgress, emptyOfficialRailEvidence, SPONSOR_BANK_CANDIDATES,
  SPONSOR_DUE_DILIGENCE_CHECKS, sponsorBankDocumentaryReady,
} from '../app/lib/platform/sponsor-bank.ts';
import { matchReconciliationEntries } from '../app/lib/platform/reconciliation.ts';
import { systemAmountRisk } from '../app/lib/platform/risk-engine.ts';
import { csvObjects, CsvError } from '../app/lib/platform/csv.ts';
import { ACCESS_POLICY, ROLE_PROFILES, assignableRole, canManageRole, normalizeAccessEmail, roleCan, rolesFor } from '../app/lib/platform/access-policy.ts';
import { approvalActionType, approvalExpiryMinutes, approvalReason, canDecideApproval } from '../app/lib/platform/approval-policy.ts';
import { normalizeEvidenceLink, normalizeOperationalNote, normalizeWorkItemUpdate } from '../app/lib/platform/operations-input.ts';
import { normalizeRiskRuleInput, normalizeRiskSimulationSamples, normalizeRiskStepUpCredential, normalizeRiskStepUpInput } from '../app/lib/platform/risk-input.ts';
import { normalizeDueDiligenceCancellation, normalizeDueDiligenceCaseInput, normalizeDueDiligenceCheckInput, normalizeDueDiligenceDecisionInput, normalizeDueDiligencePartyInput } from '../app/lib/platform/due-diligence-input.ts';
import { normalizeRawRiskSignals, parseProtectedRiskSignals, protectRiskSignals, publicRiskSignals, riskSubjectHash, riskSubjectPreview } from '../app/lib/platform/risk-signals.ts';
import { initialCardStatus, normalizeCardControlsInput, normalizeCardProgramInput, normalizeCardTransition } from '../app/lib/platform/card-issuing.ts';
import { authenticatedFetch } from '../app/lib/platform/client-http.ts';
import { disputeEvent, disputeNextStatus, disputePossibleEvents, disputeReason, isOpenDispute } from '../app/lib/platform/disputes.ts';
import { normalizeBillerInput, normalizeBillPaymentInput, normalizeLifecycleAction, normalizeMandateInput, normalizeObligationInput, normalizeProtectedReference } from '../app/lib/platform/billers-input.ts';
import { normalizePayoutBatchInput, normalizePayoutBeneficiaryInput, normalizePayoutBeneficiaryStatus, normalizePayoutDestination } from '../app/lib/platform/payouts-input.ts';
import { parseBookTransferInput, statementPeriod } from '../app/lib/platform/book-transfers-input.ts';
import { normalizeWalletInput, normalizeWalletProgramInput, normalizeWalletTransition, parseWalletPocketTransferInput } from '../app/lib/platform/wallets-input.ts';
import { classifyRailValue, isSandboxCvu, isWellFormedCbu, issueSandboxCvu, normalizeAlias } from '../app/lib/platform/cbu.ts';
import { aliasChangeBlocked, ALIAS_CHANGE_WINDOW_MS, normalizeAssignAliasInput, normalizeDebitRequestInput, normalizeInstantTransferInput, normalizeIssueInstrumentInput, normalizePaymentQrInput, normalizeQrDebtInput, normalizeQrSaleOrderInput } from '../app/lib/platform/instant-payments-input.ts';
import { normalizeCollectionTillInboundInput, normalizeCollectionTillInput, normalizeCollectionTillStaticQrInput, normalizePaymentLinkInput, normalizePaymentLinkPayInput, normalizePaymentLinkRefundInput } from '../app/lib/platform/collections-input.ts';
import { normalizeCuit } from '../app/lib/platform/cuit.ts';
import { normalizeEcheqAcceptInput, normalizeEcheqDepositInput, normalizeEcheqEndorseInput, normalizeEcheqInput } from '../app/lib/platform/echeqs-input.ts';
import { isLocalPostgres, postgresClientOptions, resolvePostgresUrl } from '../db/postgres-connection.mjs';

process.env.CIMBRA_ENCRYPTION_KEY = '3ea72fc13c567057870342c6ebd34d88f58f6d80b1dba61c4be4e1c2f1406afb';

test('crea API keys opacas y sólo valida el hash correcto', async () => {
  const key = createApiKey();
  assert.equal(apiKeyPrefix(key.token), key.prefix);
  const hash = await hashApiKey(key.token);
  assert.equal(await verifyApiKey(key.token, hash), true);
  assert.equal(await verifyApiKey(`${key.token}x`, hash), false);
  assert.equal(apiKeyPrefix('cim_sk_test_invalid'), null);
  assert.equal(apiKeyEnvironment(key.token), 'test');
  const live = createApiKey('live');
  assert.equal(apiKeyEnvironment(live.token), 'live');
  assert.match(live.token, /^cim_sk_live_/);
  assert.equal(apiKeyPrefix(live.token), live.prefix);
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
  assert.equal(replay.headers.get('cimbra-environment'), 'sandbox');
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
  assert.equal(PLATFORM_CAPABILITIES.every((capability) => capability.availability !== 'live'), true);
  assert.deepEqual([...PLATFORM_SUMMARY.availabilityModel], ['live', 'sandbox', 'foundation', 'roadmap']);
  const financialCore = PLATFORM_CAPABILITIES.find((item) => item.id === 'financial-core');
  assert.equal(financialCore?.summary.includes('fees'), false);
  assert.equal(financialCore?.summary.includes('límites'), false);
  const payments = PLATFORM_CAPABILITIES.find((item) => item.id === 'payment-orchestration');
  assert.equal(payments?.features.includes('payment intents'), false);
  assert.equal(payments?.features.includes('routing por reglas'), false);
  assert.ok(PLATFORM_CAPABILITIES.some((item) => item.id === 'customers-kyc' && item.features.includes('gate a cuentas y wallets')));
});

test('live permanece fail-closed y el catálogo cita productos públicos de BIND, Pomelo y tapi', () => {
  const previous = process.env.CIMBRA_OPERATING_MODE;
  const previousHost = process.env.CIMBRA_PRODUCTION_HOSTNAME;
  try {
    delete process.env.CIMBRA_OPERATING_MODE;
    delete process.env.CIMBRA_PRODUCTION_HOSTNAME;
    const current = evaluateLiveReadiness();
    assert.equal(current.effectiveMode, 'sandbox');
    assert.equal(current.liveReady, false);
    assert.equal(current.blockReason, 'production_hostname_not_provisioned');
    assert.equal(current.goLive.benchmark, 'Pomelo');
    assert.equal(current.goLive.current, 'integracion');
    assert.equal(current.goLive.documentationUrl, 'https://docs.pomelo.la/docs/get-started/home');
    assert.equal(current.environments.find((item) => item.id === 'production')?.hostname, null);
    assert.equal(current.environments.find((item) => item.id === 'production')?.pciHostname, null);
    assert.equal(current.products.every((product) => product.status === 'integracion'), true);
    assert.equal(current.products.some((product) => product.id === 'transfers' && product.documentationUrl === 'https://apibank.bind.com.ar/'), true);
    assert.equal(current.products.some((product) => product.id === 'qr_interoperable' && product.documentationUrl === 'https://psp.bind.com.ar/developers/apis/pagar-qr'), true);
    assert.equal(current.products.some((product) => product.id === 'card_issuing' && product.documentationUrl === 'https://developers.pomelo.la/api-reference/cards/issuing'), true);
    assert.equal(current.products.some((product) => product.id === 'bill_payments' && product.documentationUrl === 'https://tapi.la/'), true);
    assert.equal(PLATFORM_PRODUCTS.some((product) => product.id.startsWith('ar_coelsa')), false);
    for (const reference of COMPETITOR_REFERENCES) assert.match(reference.url, /^https:\/\//);
    requireSandboxLedgerOrCertifiedRail('transfers');
    assert.throws(() => requireLiveApiKeysEnabled(), (error: unknown) => error instanceof PlatformRailError && error.code === 'live_environment_disabled');
    process.env.CIMBRA_OPERATING_MODE = 'live';
    const blocked = evaluateLiveReadiness();
    assert.equal(blocked.requestedMode, 'live');
    assert.equal(blocked.effectiveMode, 'sandbox');
    assert.equal(blocked.liveBlocked, true);
    const homologated = evaluateLiveReadiness(PLATFORM_PRODUCTS.map((product) => ({ id: product.id, status: 'go_live' as const })));
    assert.equal(homologated.summary.goLive, PLATFORM_PRODUCTS.length);
    assert.equal(homologated.liveReady, false);
    process.env.CIMBRA_PRODUCTION_HOSTNAME = 'https://api.example-cimbra.test';
    const stillClosed = evaluateLiveReadiness();
    assert.equal(stillClosed.liveReady, false);
    const withProduct = evaluateLiveReadiness([{ id: 'transfers', status: 'go_live' }]);
    assert.equal(withProduct.liveReady, false);
    assert.equal(withProduct.blockReason, 'official_rails_not_live');
    const withRails = evaluateLiveReadiness(
      [{ id: 'transfers', status: 'go_live' }],
      requiredRailIdsForProduct('transfers').map((id) => ({ id, status: 'live' as const })),
    );
    assert.equal(withRails.liveReady, false);
    assert.equal(withRails.blockReason, 'official_rail_adapter_missing');
    assert.equal(withRails.effectiveMode, 'sandbox');
    assert.equal(current.fintechPath.intendedFigure, 'PSPCP');
    assert.equal(current.fintechPath.metCount, 0);
    assert.equal(current.rails.every((rail) => rail.status === 'unwired' && rail.adapterRegistered === false), true);
    assert.equal(current.capitalPlan.envelope, 500);
    assert.equal(current.capitalPlan.spent, 0);
    assert.equal(current.capitalPlan.liveReadyAfterSpend, false);
    assert.equal(current.capitalPlan.allocated, 500);
    assert.equal(current.capitalPlan.remaining, 500);
  } finally {
    if (previous === undefined) delete process.env.CIMBRA_OPERATING_MODE;
    else process.env.CIMBRA_OPERATING_MODE = previous;
    if (previousHost === undefined) delete process.env.CIMBRA_PRODUCTION_HOSTNAME;
    else process.env.CIMBRA_PRODUCTION_HOSTNAME = previousHost;
  }
});

test('los rieles oficiales son contrapartes reguladas y el adaptador falla cerrado', () => {
  const competitors = /bind|dock|tapi|pismo|pomelo|wibond/i;
  assert.ok(OFFICIAL_RAIL_CONNECTIONS.length >= 10);
  assert.equal(new Set(OFFICIAL_RAIL_CONNECTIONS.map((rail) => rail.id)).size, OFFICIAL_RAIL_CONNECTIONS.length);
  assert.deepEqual(Object.keys(OFFICIAL_RAIL_ADAPTERS), []);
  assert.ok(OFFICIAL_RAIL_CONNECTIONS.some((rail) => rail.id === 'sponsor_bank'));
  for (const rail of OFFICIAL_RAIL_CONNECTIONS) {
    assert.equal(competitors.test(rail.counterparty), false, rail.id);
    assert.equal(competitors.test(rail.officialUrl), false, rail.id);
    assert.match(rail.officialUrl, /^https:\/\//);
    assert.ok(rail.wiringContract.length > 20);
    for (const productId of rail.productIds) {
      assert.ok(PLATFORM_PRODUCTS.some((product) => product.id === productId), `${rail.id} → ${productId}`);
    }
  }
  for (const product of PLATFORM_PRODUCTS) {
    assert.ok(requiredRailIdsForProduct(product.id).length > 0, product.id);
  }
  const qr = evaluateLiveReadiness().products.find((product) => product.id === 'qr_interoperable');
  assert.match(qr?.sandboxCoverage ?? '', /cimbra:qr:static:v1/);
  assert.match(qr?.sandboxCoverage ?? '', /orden de venta/);
  assert.match(qr?.sandboxCoverage ?? '', /cimbra:qr:debt:v1/);
  assert.match(qr?.sandboxCoverage ?? '', /till/);
  assert.match(qr?.missingForProduction ?? '', /PCT Coelsa/);
  const collections = evaluateLiveReadiness().products.find((product) => product.id === 'collections');
  assert.match(collections?.sandboxCoverage ?? '', /cimbra_qr/);
  assert.match(collections?.sandboxCoverage ?? '', /cimbra_cvu/);
  assert.match(collections?.sandboxCoverage ?? '', /parcial/);
  assert.match(collections?.sandboxCoverage ?? '', /devolución/);
  assert.match(collections?.sandboxCoverage ?? '', /ítems/);
  assert.match(collections?.sandboxCoverage ?? '', /QR estático del till/);
  assert.throws(
    () => dispatchOfficialRail('coelsa_transfers', [{ id: 'coelsa_transfers', status: 'unwired' }]),
    (error: unknown) => error instanceof PlatformRailError && error.code === 'rail_not_wired',
  );
  assert.throws(
    () => dispatchOfficialRail('coelsa_transfers', [{ id: 'coelsa_transfers', status: 'live' }]),
    (error: unknown) => error instanceof PlatformRailError && error.code === 'rail_adapter_missing',
  );
});

test('el envelope de USD 500 cubre Gate 1 y no habilita live ni rieles', () => {
  const plan = capitalPlanSnapshot();
  assert.equal(plan.envelope, 500);
  assert.equal(plan.allocated, 500);
  assert.equal(plan.remaining, 500);
  assert.equal(plan.spent, 0);
  assert.equal(plan.liveReadyAfterSpend, false);
  assert.equal(plan.commercialGate, 'gate_1_design_partners');
  assert.equal(plan.raise.amountUsd, null);
  assert.equal(isForbiddenCapitalSpend('aws_paid'), true);
  assert.equal(isForbiddenCapitalSpend('coelsa_membership'), true);
  assert.equal(isForbiddenCapitalSpend('mark_go_live'), true);
  assert.equal(isForbiddenCapitalSpend('competitor_connector'), true);
  assert.equal(isForbiddenCapitalSpend('sponsor_bank'), true);
  assert.equal(isForbiddenCapitalSpend('legal_consult'), false);
  const spentPlan = capitalPlanSnapshot([{ id: 'legal_consult', status: 'spent' }]);
  assert.equal(spentPlan.spent, 200);
  assert.equal(spentPlan.remaining, 300);
  assert.equal(spentPlan.liveReadyAfterSpend, false);
  assert.equal(normalizeDemoIntent('investor'), 'investor');
  assert.equal(normalizeDemoIntent('unknown'), 'design_session');
  assert.match(composeLeadMessage('investor', 'hola'), /^\[intent:investor\] hola$/);
  assert.equal(composeLeadMessage('design_session', 'hola'), 'hola');
  const evidence = buildInvestorEvidence();
  assert.equal(evidence.liveReady, false);
  assert.equal(evidence.traction.payingCustomers, 0);
  assert.equal(evidence.traction.monthlyVolumeUsd, 0);
  assert.equal(evidence.traction.lettersOfIntent, 0);
  assert.equal(evidence.product.productsGoLive, 0);
  assert.ok(PLATFORM_CAPABILITIES.some((item) => item.id === 'capital-live-path' && item.availability === 'foundation'));
  assert.ok(PLATFORM_CAPABILITIES.some((item) => item.id === 'tenant-support' && item.availability === 'sandbox'));
  assert.ok(PLATFORM_CAPABILITIES.some((item) => item.id === 'domain-services' && item.availability === 'foundation'));
  assert.equal(evidence.product.services.standalone, 0);
  assert.ok(evidence.product.services.total >= 10);
});

test('soporte, organización y operadores de plataforma validan entrada sin inventar SLA', () => {
  assert.deepEqual(normalizeSupportCaseInput({
    category: 'api', subject: 'Webhook sin reintento', message: 'El delivery quedó failed y no vi replay.',
  }), { category: 'api', subject: 'Webhook sin reintento', message: 'El delivery quedó failed y no vi replay.' });
  assert.equal(normalizeSupportCaseInput({ category: 'api', subject: 'x', message: 'corto' }), null);
  assert.deepEqual(normalizeSupportMessageInput({ body: 'Reenvío el request id.' }), { body: 'Reenvío el request id.' });
  assert.equal(normalizeSupportMessageInput({ body: 'no' }), null);
  assert.deepEqual(normalizeOrganizationPatch({ name: 'Comercio Sur', country: 'AR' }), { name: 'Comercio Sur', country: 'AR' });
  assert.equal(normalizeOrganizationPatch({ country: 'US' }), null);
  assert.deepEqual(normalizeLeadStatusInput({ status: 'qualified' }), { status: 'qualified' });
  assert.equal(normalizeLeadStatusInput({ status: 'hot' }), null);
  const previous = process.env.CIMBRA_PLATFORM_OPERATOR_EMAILS;
  process.env.CIMBRA_PLATFORM_OPERATOR_EMAILS = 'ops@cimbra.test, invalid, OPS@cimbra.test';
  assert.deepEqual(platformOperatorEmails(), ['ops@cimbra.test']);
  assert.equal(isPlatformOperatorEmail('OPS@cimbra.test'), true);
  assert.equal(isPlatformOperatorEmail('owner@tenant.test'), false);
  assert.equal(platformOperatorProvisioned(), true);
  process.env.CIMBRA_PLATFORM_OPERATOR_EMAILS = previous;
  const topology = serviceTopology();
  assert.equal(topology.totals.standalone, 0);
  assert.equal(topology.totals.services, SERVICE_CATALOG.length);
  assert.ok(SERVICE_CATALOG.some((service) => service.id === 'support'));
  assert.ok(SERVICE_CATALOG.some((service) => service.id === 'tenants'));
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
  assert.deepEqual(rolesFor('cards.program.manage'), ['owner', 'admin']);
  assert.deepEqual(rolesFor('wallets.program.manage'), ['owner', 'admin']);
  assert.deepEqual(rolesFor('credentials.manage'), ['owner', 'admin']);
  assert.deepEqual(rolesFor('approvals.policy.manage'), ['owner']);
  assert.equal(roleCan('owner', 'approvals.policy.manage'), true);
  assert.equal(roleCan('admin', 'approvals.policy.manage'), false);
  assert.equal(roleCan('admin', 'credentials.manage'), true);
  assert.equal(roleCan('operator', 'finance.write'), true);
  assert.equal(roleCan('operator', 'cards.program.manage'), false);
  assert.equal(roleCan('operator', 'wallets.program.manage'), false);
  assert.equal(roleCan('admin', 'billers.manage'), true);
  assert.equal(roleCan('operator', 'billers.manage'), false);
  assert.equal(roleCan('admin', 'payouts.beneficiaries.manage'), true);
  assert.equal(roleCan('operator', 'payouts.beneficiaries.manage'), false);
  assert.equal(roleCan('operator', 'credentials.manage'), false);
  assert.equal(roleCan('viewer', 'console.read'), true);
  assert.equal(roleCan('viewer', 'disputes.read'), true);
  assert.equal(roleCan('viewer', 'disputes.write'), false);
  for (const capability of Object.keys(ACCESS_POLICY) as Array<keyof typeof ACCESS_POLICY>) {
    if (!['console.read', 'disputes.read', 'operations.read', 'approvals.read', 'support.read', 'organization.read', 'security.manage_self'].includes(capability)) assert.equal(roleCan('viewer', capability), false, capability);
  }
  assert.equal(ROLE_PROFILES.viewer.posture, 'Sólo lectura');
});

test('payouts protegen destinos y acotan lotes inmutables a 100 ítems', () => {
  assert.equal(normalizePayoutDestination(' proveedor.cimbra '), 'PROVEEDOR.CIMBRA');
  assert.equal(normalizePayoutDestination('x'), null);
  assert.deepEqual(normalizePayoutBeneficiaryInput({ externalReference: ' PROVIDER-001 ', name: ' Proveedor Regional ', entityType: 'business',
    country: 'ar', currency: 'ars', destinationType: 'alias', destination: 'proveedor.cimbra', bankCode: ' bank-01 ' }), {
    externalReference: 'PROVIDER-001', name: 'Proveedor Regional', entityType: 'business', country: 'AR', currency: 'ARS',
    destinationType: 'alias', destination: 'PROVEEDOR.CIMBRA', bankCode: 'bank-01',
  });
  assert.equal(normalizePayoutBeneficiaryInput({ externalReference: 'P-1', name: 'Proveedor', entityType: 'business', country: 'AR',
    currency: 'ARS', destinationType: 'competitor', destination: 'provider-1234' }), null);
  const batch = normalizePayoutBatchInput({ sourceAccountId: 'account-1', externalReference: 'BATCH-001', description: 'Liquidación mensual',
    currency: 'ARS', items: [{ externalReference: 'ITEM-001', beneficiaryId: 'beneficiary-1', amount: '1250.50', description: 'Liquidación' }] });
  assert.ok(batch); assert.equal(batch.items[0].amountMinor, 125050n);
  assert.equal(normalizePayoutBatchInput({ sourceAccountId: 'account-1', externalReference: 'BATCH-001', description: 'Liquidación mensual',
    currency: 'ARS', items: [{ externalReference: 'DUP', beneficiaryId: 'beneficiary-1', amount: '1', description: 'Uno' },
      { externalReference: 'DUP', beneficiaryId: 'beneficiary-2', amount: '2', description: 'Dos' }] }), null);
  assert.equal(normalizePayoutBeneficiaryStatus({ action: 'suspend' }), 'suspend');
  assert.equal(normalizePayoutBeneficiaryStatus({ action: 'delete' }), null);
});

test('book transfers exigen cuentas distintas, moneda válida y períodos acotados', () => {
  const sourceAccountId = '00000000-0000-4000-8000-000000000001';
  const destinationAccountId = '00000000-0000-4000-8000-000000000002';
  const parsed = parseBookTransferInput({ externalReference: ' BT-001 ', sourceAccountId, destinationAccountId,
    description: ' Distribución interna ', amount: '1250.50', currency: 'ars' });
  assert.ok(parsed); assert.equal(parsed.amountMinor, 125050n); assert.equal(parsed.currency, 'ARS');
  assert.equal(parseBookTransferInput({ externalReference: 'BT-002', sourceAccountId, destinationAccountId: sourceAccountId,
    description: 'Inválida', amount: '1.00', currency: 'ARS' }), null);
  assert.equal(parseBookTransferInput({ externalReference: 'BT-003', sourceAccountId, destinationAccountId,
    description: 'Inválida', amount: '0', currency: 'ARS' }), null);
  const validPeriod = statementPeriod(new URL('https://api.test/statement?from=2026-08-01T00:00:00.000Z&to=2026-08-31T00:00:00.000Z'));
  assert.deepEqual(validPeriod, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' });
  assert.equal(statementPeriod(new URL('https://api.test/statement?from=2024-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z')), null);
});

test('la conexión PostgreSQL exige TLS remoto, desactiva prepared statements y prefiere la URL directa para migrar', () => {
  const keys = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_URL_UNPOOLED',
    'DATABASE_URL_NON_POOLING', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL_UNPOOLED_DIRECT',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.DATABASE_URL = 'postgresql://cimbra:secret@ep-demo-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://cimbra:secret@ep-demo.us-east-1.aws.neon.tech/neondb?sslmode=require';
    assert.equal(resolvePostgresUrl(), process.env.DATABASE_URL);
    assert.equal(resolvePostgresUrl({ preferDirect: true }), process.env.DATABASE_URL_UNPOOLED);
    const remote = postgresClientOptions(process.env.DATABASE_URL);
    assert.equal(remote.ssl, 'require');
    assert.equal(remote.prepare, false);
    assert.equal(remote.connect_timeout, 30);
    const local = postgresClientOptions('postgresql://cimbra:secret@127.0.0.1:5432/cimbra');
    assert.equal(local.ssl, false);
    assert.equal(local.connect_timeout, 10);
    assert.equal(isLocalPostgres('postgresql://cimbra:secret@localhost:5432/cimbra'), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('wallets validan programas, pockets disponibles y transiciones terminales', () => {
  const programId = '00000000-0000-4000-8000-000000000001';
  const customerId = '00000000-0000-4000-8000-000000000002';
  const sourcePocketId = '00000000-0000-4000-8000-000000000003';
  const destinationPocketId = '00000000-0000-4000-8000-000000000004';
  assert.deepEqual(normalizeWalletProgramInput({ name: '  Wallet Mercado  ', displayName: ' Billetera Sur ',
    defaultCurrency: 'ars', allowedCurrencies: ['ARS', 'usd'], pocketKinds: ['available', 'rewards'] }), {
    name: 'Wallet Mercado', displayName: 'Billetera Sur', supportUrl: null, termsUrl: null, accentColor: null,
    defaultCurrency: 'ARS', allowedCurrencies: ['ARS', 'USD'], pocketKinds: ['available', 'rewards'],
  });
  assert.equal(normalizeWalletProgramInput({ name: 'X', displayName: 'X', defaultCurrency: 'ARS' }), null);
  assert.equal(normalizeWalletProgramInput({ name: 'Wallet', displayName: 'Wallet', defaultCurrency: 'ARS', pocketKinds: ['pending'] }), null);
  assert.deepEqual(normalizeWalletInput({ programId, customerId, externalReference: ' WALLET-001 ' }), {
    programId, customerId, externalReference: 'WALLET-001',
  });
  assert.deepEqual(normalizeWalletTransition({ status: 'frozen', reason: 'suspected_fraud' }, 'active'), {
    status: 'frozen', reason: 'suspected_fraud',
  });
  assert.equal(normalizeWalletTransition({ status: 'active', reason: 'issued' }, 'closed'), null);
  const transfer = parseWalletPocketTransferInput({ externalReference: 'WP-001', sourcePocketId, destinationPocketId,
    description: ' Distribución ', amount: '10.50', currency: 'ars' });
  assert.ok(transfer); assert.equal(transfer.amountMinor, 1050n);
  assert.equal(parseWalletPocketTransferInput({ externalReference: 'WP-002', sourcePocketId, destinationPocketId: sourcePocketId,
    description: 'Inválida', amount: '1', currency: 'ARS' }), null);
});

test('pagos instantáneos validan CBU/CVU, alias, titular y límites de riel sandbox', () => {
  const accountId = '00000000-0000-4000-8000-000000000010';
  const cvu = issueSandboxCvu(accountId);
  const tillCvu = issueSandboxCvu(accountId, '00000000-0000-4000-8000-000000000099');
  assert.equal(isWellFormedCbu(cvu), true);
  assert.equal(isSandboxCvu(cvu), true);
  assert.equal(isSandboxCvu(tillCvu), true);
  assert.notEqual(tillCvu, cvu);
  assert.notEqual(issueSandboxCvu(accountId, 'till-b'), tillCvu);
  assert.equal(isSandboxCvu('0110023500000000012342'), false);
  assert.equal(isWellFormedCbu('0110023500000000012342'), true);
  assert.deepEqual(classifyRailValue(cvu), { kind: 'cvu', value: cvu });
  assert.deepEqual(classifyRailValue('0110023500000000012342'), { kind: 'cbu', value: '0110023500000000012342' });
  assert.equal(normalizeAlias('comercio.sur'), 'COMERCIO.SUR');
  assert.equal(normalizeAlias('ab'), null);
  assert.deepEqual(normalizeIssueInstrumentInput({ accountId, alias: 'comercio.sur' }), { accountId, alias: 'COMERCIO.SUR' });
  assert.deepEqual(normalizeAssignAliasInput({ alias: 'comercio.oeste' }), { alias: 'COMERCIO.OESTE' });
  assert.equal(normalizeAssignAliasInput({ alias: 'ab' }), null);
  assert.equal(normalizeAssignAliasInput({ alias: 'COMERCIO.OESTE', extra: true }), null);
  assert.equal(aliasChangeBlocked(null), false);
  assert.equal(aliasChangeBlocked(new Date(Date.now() - 60_000).toISOString()), true);
  assert.equal(aliasChangeBlocked(new Date(Date.now() - ALIAS_CHANGE_WINDOW_MS - 1_000).toISOString()), false);
  const transfer = normalizeInstantTransferInput({
    externalReference: 'IP-001', accountId, destination: cvu, description: ' Cobro ', amount: '10.50', currency: 'ars',
    confirmHolder: true, holderName: ' Comercio Sur ', taxIdLast4: '5678',
  });
  assert.ok(transfer); assert.equal(transfer.amountMinor, 1050n); assert.equal(transfer.holderName, 'Comercio Sur');
  assert.equal(normalizeInstantTransferInput({
    externalReference: 'IP-002', accountId, destination: cvu, description: 'Cobro', amount: '10', currency: 'ARS', confirmHolder: false,
    holderName: 'Comercio Sur', taxIdLast4: '5678',
  }), null);
  const debit = normalizeDebitRequestInput({
    externalReference: 'DEBIN-001', collectorAccountId: accountId, payerDestination: 'COMERCIO.SUR',
    description: 'Débito interno', amount: '20', currency: 'ARS',
  });
  assert.ok(debit); assert.equal(debit.expiresInMinutes, 60);
  const qr = normalizePaymentQrInput({ accountId, description: 'Cobro mostrador', currency: 'ARS' });
  assert.ok(qr); assert.equal(qr.amountMinor, null); assert.equal(qr.kind, 'dynamic'); assert.equal(qr.expiresInMinutes, 60);
  const staticQr = normalizePaymentQrInput({ accountId, description: 'Caja mostrador', kind: 'static' });
  assert.ok(staticQr); assert.equal(staticQr.kind, 'static'); assert.equal(staticQr.expiresInMinutes, null); assert.equal(staticQr.amountMinor, null);
  assert.equal(normalizePaymentQrInput({ accountId, description: 'Caja', kind: 'static', amount: '10.00' }), null);
  assert.equal(normalizePaymentQrInput({ accountId, description: 'Caja', kind: 'static', expiresInMinutes: 60 }), null);
  const saleOrder = normalizeQrSaleOrderInput({
    paymentQrId: accountId, externalReference: 'OV-001', description: 'Mostrador', amount: '15.50', currency: 'ARS',
  });
  assert.ok(saleOrder); assert.equal(saleOrder.amountMinor, 1550n); assert.equal(saleOrder.expiresInMinutes, 10);
  assert.equal(normalizeQrSaleOrderInput({
    paymentQrId: accountId, externalReference: 'OV-002', description: 'Mostrador', amount: '15.50', expiresInMinutes: 0,
  }), null);
  const debt = normalizeQrDebtInput({
    accountId, externalReference: 'DEUDA-001', description: 'Cuota única', amount: '80.00', currency: 'ARS',
  });
  assert.ok(debt); assert.equal(debt.amountMinor, 8000n); assert.equal(debt.expiresInMinutes, 1440);
  assert.equal(normalizeQrDebtInput({
    accountId, externalReference: 'DEUDA-002', description: 'Cuota', amount: '80.00', expiresInMinutes: 4,
  }), null);
  assert.equal(normalizePaymentQrInput({ accountId, description: 'Deuda', kind: 'debt', amount: '10.00' }), null);
});

test('cobranzas validan links de cobro, medios sandbox y rechazan adquirencia de red', () => {
  const accountId = '00000000-0000-4000-8000-000000000010';
  const payerId = '00000000-0000-4000-8000-000000000011';
  const link = normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-001', description: ' Honorarios ', amount: '1500.50', currency: 'ars',
  });
  assert.ok(link); assert.ok(!('unsupportedMethod' in link));
  if (!('unsupportedMethod' in link)) {
    assert.equal(link.amountMinor, 150050n);
    assert.deepEqual(link.methods, ['internal', 'sandbox_inbound']);
    assert.deepEqual(link.items, []);
  }
  const cardCreate = normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-002', description: 'Tarjeta', amount: '10', currency: 'ARS', methods: ['card'],
  });
  assert.deepEqual(cardCreate, { unsupportedMethod: 'card' });
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-003', description: 'Vacío', amount: '10', currency: 'ARS', methods: [],
  }), null);
  const debtId = '00000000-0000-4000-8000-000000000012';
  const tillId = '00000000-0000-4000-8000-000000000013';
  const associated = normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-004', description: 'Deuda asociada', amount: '80.00', currency: 'ARS',
    methods: ['cimbra_qr', 'cimbra_cvu'], qrDebtId: debtId, collectionTillId: tillId,
  });
  assert.ok(associated); assert.ok(!('unsupportedMethod' in associated));
  if (!('unsupportedMethod' in associated)) {
    assert.deepEqual(associated.methods, ['cimbra_cvu', 'cimbra_qr']);
    assert.equal(associated.qrDebtId, debtId); assert.equal(associated.collectionTillId, tillId);
  }
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-005', description: 'QR sin deuda', amount: '10', currency: 'ARS', methods: ['cimbra_qr'],
  }), null);
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-006', description: 'Redirect', amount: '10', currency: 'ARS',
    successUrl: 'https://example.com/ok',
  }), null);
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-007', description: 'Checkout anidado', amount: '10', currency: 'ARS',
    configuracionCheckout: { items: [] },
  }), null);
  const withItems = normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-008', description: 'Con ítems', amount: '80.00', currency: 'ARS',
    items: [
      { description: 'Honorarios', amount: '50.00', quantity: 1, code: 'HON' },
      { description: 'Gastos', amount: '3.00', additional: 'Viáticos' },
    ],
  });
  assert.ok(withItems); assert.ok(!('unsupportedMethod' in withItems));
  if (!('unsupportedMethod' in withItems)) {
    assert.equal(withItems.items.length, 2);
    assert.equal(withItems.items[0].amountMinor, 5000n);
    assert.equal(withItems.items[0].quantity, 1);
    assert.equal(withItems.items[0].code, 'HON');
    assert.equal(withItems.items[1].quantity, 1);
    assert.equal(withItems.items[1].additional, 'Viáticos');
  }
  assert.ok(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-009', description: 'Sin detalle', amount: '10', currency: 'ARS', items: [],
  }));
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-010', description: 'Ítem corto', amount: '10', currency: 'ARS',
    items: [{ description: 'X', amount: '1.00' }],
  }), null);
  assert.equal(normalizePaymentLinkInput({
    accountId, externalReference: 'FAC-011', description: 'Demasiados ítems', amount: '10', currency: 'ARS',
    items: Array.from({ length: 21 }, (_, index) => ({ description: `Item ${index + 10}`, amount: '1.00' })),
  }), null);
  const qrPay = normalizePaymentLinkPayInput({ method: 'cimbra_qr', payerAccountId: payerId });
  assert.ok(qrPay); assert.ok(!('unsupportedMethod' in qrPay));
  if (!('unsupportedMethod' in qrPay)) {
    assert.equal(qrPay.method, 'cimbra_qr'); assert.equal(qrPay.amountMinor, null);
  }
  assert.equal(normalizePaymentLinkPayInput({ method: 'cimbra_qr' }), null);
  assert.deepEqual(normalizePaymentLinkPayInput({ method: 'cimbra_cvu' }), {
    method: 'cimbra_cvu', payerAccountId: null, amountMinor: null,
  });
  assert.deepEqual(normalizePaymentLinkPayInput({ method: 'cimbra_cvu', amount: '3.00' }), {
    method: 'cimbra_cvu', payerAccountId: null, amountMinor: 300n,
  });
  assert.equal(normalizePaymentLinkPayInput({ method: 'internal', payerAccountId: payerId, amount: '1.00' }), null);
  const internalPay = normalizePaymentLinkPayInput({ method: 'internal', payerAccountId: payerId });
  assert.ok(internalPay); assert.ok(!('unsupportedMethod' in internalPay));
  if (!('unsupportedMethod' in internalPay)) {
    assert.equal(internalPay.method, 'internal'); assert.equal(internalPay.payerAccountId, payerId);
    assert.equal(internalPay.amountMinor, null);
  }
  assert.equal(normalizePaymentLinkPayInput({ method: 'internal' }), null);
  assert.deepEqual(normalizePaymentLinkPayInput({ method: 'card' }), { unsupportedMethod: 'card' });
  assert.deepEqual(normalizePaymentLinkPayInput({ method: 'sandbox_inbound' }), {
    method: 'sandbox_inbound', payerAccountId: null, amountMinor: null,
  });
  assert.deepEqual(normalizePaymentLinkRefundInput({}), { amountMinor: null, creditId: null });
  assert.deepEqual(normalizePaymentLinkRefundInput({ amount: '3.00' }), { amountMinor: 300n, creditId: null });
  assert.deepEqual(normalizePaymentLinkRefundInput({
    amount: '3.00', creditId: '00000000-0000-4000-8000-000000000014',
  }), { amountMinor: 300n, creditId: '00000000-0000-4000-8000-000000000014' });
  assert.equal(normalizePaymentLinkRefundInput({ amount: '3.00', idDeuda: 1 }), null);
  assert.equal(normalizePaymentLinkRefundInput({ transaccionId: 1 }), null);
  const till = normalizeCollectionTillInput({
    accountId, externalReference: 'TILL-001', name: ' Mostrador Sur ', alias: 'comercio.sur',
  });
  assert.ok(till); assert.equal(till.name, 'Mostrador Sur'); assert.equal(till.alias, 'COMERCIO.SUR');
  assert.equal(till.issueStaticQr, false); assert.equal(till.closedAmountOnly, false); assert.equal(till.presence, 'not_present');
  const tillQr = normalizeCollectionTillInput({
    accountId, externalReference: 'TILL-QR', name: 'Caja QR', issueStaticQr: true, closedAmountOnly: true, presence: 'present',
  });
  assert.ok(tillQr); assert.equal(tillQr.issueStaticQr, true); assert.equal(tillQr.closedAmountOnly, true); assert.equal(tillQr.presence, 'present');
  assert.equal(normalizeCollectionTillInput({
    accountId, externalReference: 'TILL-BAD', name: 'Caja', issueStaticQr: true, paymentQrId: accountId,
  }), null);
  assert.equal(normalizeCollectionTillInput({ accountId, externalReference: 'TILL-BIND', name: 'Caja', soloOrden: true }), null);
  assert.equal(normalizeCollectionTillInput({ accountId, externalReference: 'T', name: 'X' }), null);
  assert.deepEqual(normalizeCollectionTillStaticQrInput({}), {});
  assert.equal(normalizeCollectionTillStaticQrInput({ codigoCaja: 'B1' }), null);
  const inbound = normalizeCollectionTillInboundInput({
    externalReference: 'INB-001', description: ' Acreditación ', amount: '11.50', currency: 'ars',
  });
  assert.ok(inbound); assert.equal(inbound.amountMinor, 1150n);
  assert.equal(normalizeCollectionTillInboundInput({ externalReference: 'INB-002', description: 'X', amount: '0' }), null);
});

test('ECHEQ valida CUIT, ciclo sandbox y rechaza descuento o cámara', () => {
  assert.equal(normalizeCuit('30000075678'), '30000075678');
  assert.equal(normalizeCuit('30-00007567-8'), '30000075678');
  assert.equal(normalizeCuit('30712345678'), null);
  const accountId = '00000000-0000-4000-8000-000000000010';
  const holderId = '00000000-0000-4000-8000-000000000011';
  const issued = normalizeEcheqInput({
    drawerAccountId: accountId, externalReference: 'CHQ-001', description: ' Alquiler ', amount: '1500.50',
    currency: 'ars', beneficiaryName: ' Comercio Sur ', beneficiaryTaxId: '30-00007567-8',
  });
  assert.ok(issued); assert.ok(!('unsupportedFeature' in issued));
  if (!('unsupportedFeature' in issued)) {
    assert.equal(issued.amountMinor, 150050n);
    assert.equal(issued.beneficiaryTaxId, '30000075678');
    assert.equal(issued.toOrder, true);
  }
  assert.deepEqual(normalizeEcheqInput({
    drawerAccountId: accountId, externalReference: 'CHQ-002', description: 'Descuento', amount: '10',
    beneficiaryName: 'Sur', beneficiaryTaxId: '30000075678', discount: true,
  }), { unsupportedFeature: 'discount' });
  assert.deepEqual(normalizeEcheqInput({
    drawerAccountId: accountId, externalReference: 'CHQ-003', description: 'USD', amount: '10', currency: 'USD',
    beneficiaryName: 'Sur', beneficiaryTaxId: '30000075678',
  }), { unsupportedFeature: 'usd' });
  const accepted = normalizeEcheqAcceptInput({ accountId: holderId, taxId: '30000075678' });
  assert.ok(accepted); assert.equal(accepted.taxId, '30000075678');
  assert.equal(normalizeEcheqAcceptInput({ accountId: holderId, taxId: '30712345678' }), null);
  const endorsed = normalizeEcheqEndorseInput({ beneficiaryName: 'Otro', beneficiaryTaxId: '20123456786' });
  assert.ok(endorsed); assert.ok(!('unsupportedFeature' in endorsed));
  assert.deepEqual(normalizeEcheqEndorseInput({
    beneficiaryName: 'Otro', beneficiaryTaxId: '20123456786', discount: true,
  }), { unsupportedFeature: 'discount' });
  const deposited = normalizeEcheqDepositInput({ accountId: holderId, taxId: '30000075678' });
  assert.ok(deposited); assert.ok(!('unsupportedFeature' in deposited));
  assert.deepEqual(normalizeEcheqDepositInput({
    accountId: holderId, taxId: '30000075678', destinationKind: 'cbu',
  }), { unsupportedFeature: 'coelsa_clearing' });
});

test('servicios y mandatos validan catálogo, referencias protegidas, importes y consentimiento', () => {
  assert.deepEqual(normalizeBillerInput({ code: ' energia ar ', name: '  Energía   Regional ', country: 'ar', category: 'utilities',
    serviceType: 'bill_payment', currency: 'ars', amountMode: 'exact', contractReference: ' DIRECT-001 ' }), {
    code: 'ENERGIAAR', name: 'Energía Regional', country: 'AR', category: 'utilities', serviceType: 'bill_payment', currency: 'ARS',
    amountMode: 'exact', minAmountMinor: null, maxAmountMinor: null, contractReference: 'DIRECT-001',
  });
  assert.equal(normalizeBillerInput({ code: 'TOPUP', name: 'Top-up', country: 'AR', category: 'telecom',
    serviceType: 'mobile_topup', currency: 'ARS', amountMode: 'range', minAmount: '1000', maxAmount: '100' }), null);
  assert.equal(normalizeBillerInput({ code: 'DEBT', name: 'Deuda', country: 'AR', category: 'utilities',
    serviceType: 'bill_payment', currency: 'ARS', amountMode: 'range', minAmount: '1', maxAmount: '2' }), null);
  assert.equal(normalizeProtectedReference(' cliente-00 1234 '), 'CLIENTE001234');
  assert.equal(normalizeProtectedReference('x'), null);

  const obligation = normalizeObligationInput({ externalReference: ' INV-001 ', subscriberReference: 'cliente-001234', amount: '18250.50',
    dueAt: '2026-09-10T21:00:00.000Z', description: ' Servicio agosto ' }, 'ARS');
  assert.ok(obligation);
  assert.equal(obligation.amountMinor, 1_825_050n);
  assert.equal(obligation.subscriberReference, 'CLIENTE001234');
  assert.deepEqual(normalizeBillPaymentInput({ accountId: 'acc_1', billerId: 'bill_1', obligationId: 'obl_1' }), {
    accountId: 'acc_1', billerId: 'bill_1', obligationId: 'obl_1', destinationReference: null, amount: undefined,
  });
  assert.equal(normalizeBillPaymentInput({ accountId: 'acc_1', billerId: 'bill_1' }), null);

  const nextChargeAt = new Date(Date.now() + 86_400_000).toISOString();
  const mandate = normalizeMandateInput({ accountId: 'acc_1', billerId: 'bill_1', subscriberReference: 'cliente-001234', frequency: 'monthly',
    amountLimit: '25000', consentReference: 'CONSENT-001', consentedAt: new Date().toISOString(), nextChargeAt });
  assert.ok(mandate);
  assert.equal(mandate.maxRetries, 3);
  assert.equal(normalizeMandateInput({ accountId: 'acc_1', billerId: 'bill_1', subscriberReference: 'cliente-001234', frequency: 'daily',
    amountLimit: '25000', consentReference: 'CONSENT-001', consentedAt: new Date().toISOString(), nextChargeAt }), null);
  assert.equal(normalizeLifecycleAction({ action: 'pause' }), 'pause');
  assert.equal(normalizeLifecycleAction({ action: 'delete' }), null);
});

test('protege referencias de riesgo por tenant y sólo expone señales derivadas', async () => {
  const raw = normalizeRawRiskSignals({ deviceReference: ' Device-ABC ', identityReference: 'Customer-42', deviceTrust: 'suspicious',
    identityVerified: false, ipCountry: 'ar', countryMismatch: true });
  assert.ok(raw);
  const protectedSignals = await protectRiskSignals('org-a', raw);
  assert.match(protectedSignals.deviceHash ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(protectedSignals.deviceHash, await riskSubjectHash('org-b', 'device', 'device-abc'));
  const exposed = publicRiskSignals(protectedSignals);
  assert.deepEqual(exposed, { deviceReferencePresent: true, identityReferencePresent: true, deviceTrust: 'suspicious',
    identityVerified: false, ipCountry: 'AR', countryMismatch: true });
  assert.doesNotMatch(JSON.stringify(exposed), /device-abc|customer-42|deviceHash|identityHash/i);
  assert.equal(parseProtectedRiskSignals({ deviceHash: 'raw-reference' }), null);
  assert.equal(normalizeRawRiskSignals({ deviceTrust: 'invalid' }), null);
  assert.equal(riskSubjectPreview('identity', 'Pduyk1HmHjDMYYporwM4mJavh2xdxMsJ2MJui6W-YlE'), 'identity •••• #6W-YlE');
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
  assert.equal(approvalActionType('transfer.reverse'), 'transfer.reverse');
  assert.equal(approvalActionType('payment.create'), 'payment.create');
  assert.equal(approvalActionType('payment.reverse'), 'payment.reverse');
  assert.equal(approvalActionType('bill_payment.create'), 'bill_payment.create');
  assert.equal(approvalActionType('bill_payment.reverse'), 'bill_payment.reverse');
  assert.equal(approvalActionType('payout_batch.execute'), 'payout_batch.execute');
  assert.equal(approvalActionType('risk.case.resolve'), 'risk.case.resolve');
  assert.equal(approvalActionType('reconciliation.exception.resolve'), 'reconciliation.exception.resolve');
  assert.equal(approvalActionType('dispute.resolve'), 'dispute.resolve');
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

test('step-up acota método, expiración, intentos y credenciales', () => {
  assert.deepEqual(normalizeRiskStepUpInput({}), { expiresInSeconds: 300, maxAttempts: 5 });
  assert.deepEqual(normalizeRiskStepUpInput({ method: 'otp', delivery: 'client_managed', expiresInSeconds: 60, maxAttempts: 1 }), {
    expiresInSeconds: 60, maxAttempts: 1,
  });
  assert.equal(normalizeRiskStepUpInput({ method: '3ds' }), null);
  assert.equal(normalizeRiskStepUpInput({ expiresInSeconds: 30 }), null);
  assert.equal(normalizeRiskStepUpInput({ maxAttempts: 11 }), null);
  assert.equal(normalizeRiskStepUpCredential({ credential: ' 123456 ' }), '123456');
  assert.equal(normalizeRiskStepUpCredential({ credential: '12345' }), null);
  assert.equal(normalizeRiskStepUpCredential({ credential: 123456 }), null);
});

test('KYC/KYB normaliza expedientes, partes, checks y decisiones sensibles', () => {
  assert.deepEqual(normalizeDueDiligenceCaseInput({ customerId: '00000000-0000-4000-8000-000000000001' }), {
    customerId: '00000000-0000-4000-8000-000000000001', expiresInDays: 90,
  });
  assert.equal(normalizeDueDiligenceCaseInput({ customerId: 'short', expiresInDays: 6 }), null);
  assert.deepEqual(normalizeDueDiligencePartyInput({ role: 'beneficial_owner', name: '  Ana   Sur  ', taxId: '20-1234-5678-9', ownershipPercentage: 25.55, pepDeclared: true }), {
    role: 'beneficial_owner', name: 'Ana Sur', taxIdLast4: '6789', ownershipBps: 2555, pepDeclared: true,
  });
  assert.equal(normalizeDueDiligencePartyInput({ role: 'beneficial_owner', name: 'Ana', taxId: '1234' }), null);
  assert.deepEqual(normalizeDueDiligenceCheckInput({ checkType: 'sanctions', source: 'official_registry', status: 'passed', resultCode: ' NO MATCH ', note: 'Fuente oficial consultada.', evidenceDocumentId: '' }), {
    checkType: 'sanctions', source: 'official_registry', status: 'passed', resultCode: 'no_match', note: 'Fuente oficial consultada.', evidenceDocumentId: null,
  });
  assert.equal(normalizeDueDiligenceCheckInput({ checkType: 'biometric', source: 'competitor', status: 'passed', resultCode: 'ok', note: 'No permitido' }), null);
  assert.deepEqual(normalizeDueDiligenceDecisionInput({ decision: 'approve', riskRating: 'low', note: 'Control independiente completo.' }), {
    decision: 'approve', riskRating: 'low', note: 'Control independiente completo.',
  });
  assert.equal(normalizeDueDiligenceDecisionInput({ decision: 'approve', riskRating: 'prohibited', note: 'Inconsistente' }), null);
  assert.deepEqual(normalizeDueDiligenceCancellation({ note: ' Duplicado operativo ' }), { note: 'Duplicado operativo' });
});

test('disputes aplica un lifecycle explícito y terminal', () => {
  assert.equal(disputeReason('card_not_present'), 'card_not_present');
  assert.equal(disputeReason('unknown'), null);
  assert.equal(disputeEvent('start_review'), 'start_review');
  assert.equal(disputeNextStatus('opened', 'start_review'), 'under_review');
  assert.equal(disputeNextStatus('under_review', 'mark_network_ready'), 'network_ready');
  assert.equal(disputeNextStatus('network_ready', 'resolve_won'), 'won');
  assert.equal(disputeNextStatus('won', 'cancel'), null);
  assert.deepEqual(disputePossibleEvents('opened'), ['start_review', 'cancel']);
  assert.equal(isOpenDispute('network_ready'), true);
  assert.equal(isOpenDispute('lost'), false);
});

test('la consola normaliza fallos de red y respuestas no JSON sin dejar acciones colgadas', async () => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    global.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const networkFailure = await authenticatedFetch('/api/v1/test');
    assert.equal(networkFailure.status, 503);
    assert.equal(networkFailure.headers.get('cimbra-should-retry'), 'true');
    assert.deepEqual(await networkFailure.json(), { error: 'No pudimos conectar con Cimbra. Reintentá en unos segundos.' });

    global.fetch = (async () => new Response('<html>upstream failure</html>', {
      status: 502, headers: { 'Content-Type': 'text/html' },
    })) as typeof fetch;
    const invalidResponse = await authenticatedFetch('/api/v1/test');
    assert.equal(invalidResponse.status, 502);
    assert.deepEqual(await invalidResponse.json(), { error: 'No pudimos conectar con Cimbra. Reintentá en unos segundos.' });
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('card issuing valida programas y un lifecycle explícito con estado terminal', () => {
  assert.deepEqual(normalizeCardProgramInput({ name: '  Débito Regional  ', product: 'debit',
    formats: ['physical', 'virtual'], defaultCurrency: 'ars' }), {
    name: 'Débito Regional', product: 'debit', formats: ['physical', 'virtual'], defaultCurrency: 'ARS',
  });
  assert.equal(normalizeCardProgramInput({ name: 'X', product: 'debit', formats: [], defaultCurrency: 'ARS' }), null);
  assert.equal(initialCardStatus('physical'), 'created');
  assert.equal(initialCardStatus('virtual'), 'active');
  assert.deepEqual(normalizeCardTransition({ status: 'active', reason: 'activation' }, 'created'), { status: 'active', reason: 'activation' });
  assert.deepEqual(normalizeCardTransition({ status: 'frozen', reason: 'suspected_fraud' }, 'active'), { status: 'frozen', reason: 'suspected_fraud' });
  assert.equal(normalizeCardTransition({ status: 'active', reason: 'activation' }, 'terminated'), null);
  assert.equal(normalizeCardTransition({ status: 'terminated', reason: 'review_cleared' }, 'active'), null);
});

test('card controls convierte montos a minor units y rechaza jerarquías o MCC ambiguos', () => {
  assert.deepEqual(normalizeCardControlsInput({ currency: 'ARS', perTransactionLimit: '2500.50', dailyLimit: '5000',
    monthlyLimit: '30000', allowedChannels: ['chip', 'ecommerce'], allowedMccs: ['5411'], blockedMccs: ['7995'], status: 'active' }), {
    currency: 'ARS', perTransactionLimitMinor: '250050', dailyLimitMinor: '500000', monthlyLimitMinor: '3000000',
    allowedChannels: ['chip', 'ecommerce'], allowedMccs: ['5411'], blockedMccs: ['7995'], status: 'active',
  });
  assert.equal(normalizeCardControlsInput({ currency: 'ARS', perTransactionLimit: '6000', dailyLimit: '5000', monthlyLimit: '30000',
    allowedChannels: ['chip'], allowedMccs: [], blockedMccs: [], status: 'active' }), null);
  assert.equal(normalizeCardControlsInput({ currency: 'ARS', perTransactionLimit: null, dailyLimit: null, monthlyLimit: null,
    allowedChannels: ['chip'], allowedMccs: ['7995'], blockedMccs: ['7995'], status: 'active' }), null);
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

test('el banco patrocinante admite evidencia documental sin adoptar bindX como core', () => {
  assert.ok(SPONSOR_BANK_CANDIDATES.some((item) => item.id === 'bind_banco_ef'));
  assert.ok(SPONSOR_DUE_DILIGENCE_CHECKS.some((item) => item.id === 'no_competitor_baas' && item.required));
  const base = {
    ...emptyOfficialRailEvidence(),
    counterpartyLegalName: 'Entidad Financiera Regulada SA',
    counterpartyTaxId: '30712345678',
    contractReference: 'PAT-2026-001',
    safeguardingAccountRef: 'cta-clientes-001',
    dueDiligence: SPONSOR_DUE_DILIGENCE_CHECKS.filter((item) => item.required).map((item) => ({
      checkId: item.id, status: 'passed' as const, note: 'ok', updatedAt: '2026-09-02T00:00:00.000Z',
    })),
  };
  assert.equal(assertSponsorBankTransition('unwired', 'live', base), 'Transición inválida de unwired a live.');
  assert.equal(assertSponsorBankTransition('unwired', 'negotiating', emptyOfficialRailEvidence()), null);
  assert.equal(assertSponsorBankTransition('negotiating', 'contracted', base), null);
  assert.equal(assertSponsorBankTransition('contracted', 'certified', base), null);
  assert.equal(sponsorBankDocumentaryReady(base, 'certified'), true);
  assert.equal(dueDiligenceProgress(base.dueDiligence).requiredMet, true);

  const blocked = {
    ...base,
    dueDiligence: base.dueDiligence.map((item) => (
      item.checkId === 'no_competitor_baas' ? { ...item, status: 'failed' as const } : item
    )),
  };
  assert.match(assertSponsorBankTransition('contracted', 'certified', blocked) ?? '', /BaaS competidor/);

  const rails = materializeOfficialRails([{ id: 'sponsor_bank', status: 'certified', evidence: base }]);
  const sponsor = rails.find((rail) => rail.id === 'sponsor_bank');
  assert.equal(sponsor?.adapterRegistered, true);
  assert.equal(sponsor?.dueDiligenceRequiredMet, true);
  assert.equal(evaluateLiveReadiness([], [{ id: 'sponsor_bank', status: 'certified' }]).liveReady, false);
});
