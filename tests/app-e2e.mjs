import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { del } from '@vercel/blob';
import postgres from 'postgres';
import { postgresClientOptions, resolvePostgresUrl } from '../db/postgres-connection.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3010';
const target = new URL(baseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname) && process.env.ALLOW_REMOTE_E2E !== '1') {
  throw new Error('El E2E remoto requiere ALLOW_REMOTE_E2E=1.');
}

const runId = randomUUID();
const email = `cimbra-qa-${runId}@example.test`;
const username = `qa${runId.replaceAll('-', '').slice(0, 20)}`;
const password = `Cimbra-QA-${runId}!`;
const replacementPassword = `Cimbra-QA-Recovered-${runId}!`;
const checkerEmail = `cimbra-checker-${runId}@example.test`;
const checkerUsername = `checker${runId.replaceAll('-', '').slice(0, 16)}`;
const checkerPassword = `Cimbra-Checker-${runId}!`;
const databaseUrl = resolvePostgresUrl({ preferDirect: true });
const sql = postgres(databaseUrl, postgresClientOptions(databaseUrl, { max: 1 }));
let cookie = '';
let checkerCookie = '';
let userId = '';
let organizationId = '';
const authAttemptHashes = new Set();

function trackAuthAttempt(action, identifier) {
  authAttemptHashes.add(createHash('sha256').update(`${action}:identity:${identifier.trim().toLowerCase()}`).digest('base64url'));
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  return fetch(new URL(path, target), { ...init, headers, redirect: 'manual' });
}

async function json(response, status) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function waitForPayoutBatch(batchId, expectedStatuses, attempts = 40) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await json(await request(`/api/v1/payout-batches/${batchId}`), 200);
    if (expectedStatuses.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail(`El lote ${batchId} no llegó a ${expectedStatuses.join('/')} (último estado: ${last?.status ?? 'desconocido'}).`);
}

function authTokenHash(type, token) {
  return createHash('sha256').update(`cimbra-auth-token:${type}:${token}`).digest('base64url');
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let buffer = 0; const output = [];
  for (const character of value) {
    buffer = (buffer << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { output.push((buffer >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

function totp(secret, step = Math.floor(Date.now() / 30_000)) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const signature = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = signature.at(-1) & 15;
  const binary = signature.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

async function cleanup() {
  const [qaUser] = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (!qaUser) return;
  userId = qaUser.id;
  const [member] = await sql`SELECT organization_id FROM members WHERE external_user_id = ${userId} LIMIT 1`;
  if (member) {
    organizationId = member.organization_id;
    const blobs = await sql`SELECT object_key FROM compliance_documents WHERE organization_id = ${organizationId}`;
    await Promise.all(blobs.map((blob) => del(blob.object_key).catch(() => undefined)));
    await sql.begin(async (transaction) => {
      await transaction`UPDATE organizations SET status = 'deleting' WHERE id = ${organizationId}`;
      await transaction`DELETE FROM webhook_delivery_attempts WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM webhook_deliveries WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM webhook_events WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM webhook_endpoints WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM api_keys WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM approval_requests WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM approval_policies WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM settlement_cycles WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM operational_evidence_links WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM operational_notes WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM operational_actions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM dispute_events WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM disputes WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM reconciliation_exceptions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM reconciliation_items WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM reconciliation_runs WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_step_up_attempts WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_step_up_challenges WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_cases WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_outcomes WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_evaluations WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_simulations WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_rule_promotions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_rules WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM risk_list_entries WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM recurring_payment_executions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM bill_payment_orders WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM recurring_payment_mandates WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM biller_obligations WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM billers WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payout_items WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payout_batches WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payout_beneficiaries WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM qr_sale_orders WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payment_link_refunds WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payment_link_credits WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payment_links WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM qr_debts WHERE organization_id = ${organizationId}`;
      await transaction`UPDATE instant_transfers SET collection_till_id = NULL WHERE organization_id = ${organizationId}`;
      await transaction`UPDATE collection_tills SET payment_qr_id = NULL WHERE organization_id = ${organizationId}`;
      await transaction`UPDATE payment_qrs SET paid_transfer_id = NULL WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM payment_qrs WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM instant_transfers WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM collection_tills WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM echeq_endorsements WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM echeqs WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM rail_instruments WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM wallet_lifecycle_events WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM wallet_pockets WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM wallets WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM wallet_programs WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM book_transfers WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM holds WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM ledger_postings WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM ledger_journals WHERE organization_id = ${organizationId} AND reversal_of IS NOT NULL`;
      await transaction`DELETE FROM ledger_journals WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM cards WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM accounts WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM financial_accounts WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM transactions WHERE organization_id = ${organizationId} AND reversal_of IS NOT NULL`;
      await transaction`DELETE FROM transactions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM due_diligence_checks WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM due_diligence_parties WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM due_diligence_events WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM due_diligence_cases WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM compliance_documents WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM support_messages WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM support_cases WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM audit_events WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM customers WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM organization_invitations WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM members WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM organizations WHERE id = ${organizationId}`;
    });
  }
  await sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  const [checker] = await sql`SELECT id FROM users WHERE email = ${checkerEmail} LIMIT 1`;
  if (checker) {
    await sql`DELETE FROM auth_sessions WHERE user_id = ${checker.id}`;
    await sql`DELETE FROM users WHERE id = ${checker.id}`;
  }
  for (const identityHash of authAttemptHashes) await sql`DELETE FROM auth_attempts WHERE identity_hash = ${identityHash}`;
}

try {
  const health = await json(await request('/api/health'), 200);
  assert.equal(health.status, 'ok');
  assert.equal(health.dependencies.database, 'ok');
  assert.equal(health.environment, 'sandbox');
  assert.equal(health.liveReady, false);
  const publicLanding = await request('/');
  assert.equal(publicLanding.status, 200);
  const publicLandingHtml = await publicLanding.text();
  assert.match(publicLandingHtml, />Ingresar</);
  assert.match(publicLandingHtml, /ENTORNO SANDBOX/);

  trackAuthAttempt('register', email);
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Cimbra QA', username, email, password }),
  });
  await json(registration, 201);
  cookie = registration.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert.match(cookie, /cimbra_session=/);

  const authenticatedLandingHtml = await (await request('/')).text();
  assert.match(authenticatedLandingHtml, /Abrir consola/);
  assert.match(authenticatedLandingHtml, /Sesión activa/);

  assert.equal((await request('/console')).status, 200);
  const me = await json(await request('/api/auth/me'), 200);
  assert.equal(me.user.email, email);
  assert.equal(me.user.emailVerified, false);
  assert.equal(me.user.mfaEnabled, false);

  const verificationToken = randomBytes(32).toString('base64url');
  trackAuthAttempt('email_verification', verificationToken);
  await sql`
    INSERT INTO auth_action_tokens (id, user_id, type, token_hash, expires_at, created_at)
    VALUES (${randomUUID()}, ${(await sql`SELECT id FROM users WHERE email = ${email}`)[0].id}, 'email_verification',
      ${authTokenHash('email_verification', verificationToken)}, ${new Date(Date.now() + 60_000).toISOString()}, ${new Date().toISOString()})
  `;
  await json(await request('/api/auth/email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }),
  }), 200);
  await json(await request('/api/auth/email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }),
  }), 400);
  const verifiedMe = await json(await request('/api/auth/me'), 200);
  assert.equal(verifiedMe.user.emailVerified, true);

  const unknownEmail = `unknown-${runId}@example.test`;
  trackAuthAttempt('password_reset', unknownEmail);
  const forgot = await json(await request('/api/auth/password/forgot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: unknownEmail }),
  }), 200);
  assert.match(forgot.message, /Si existe una cuenta verificada/);

  const resetToken = randomBytes(32).toString('base64url');
  trackAuthAttempt('password_reset', resetToken);
  await sql`
    INSERT INTO auth_action_tokens (id, user_id, type, token_hash, expires_at, created_at)
    VALUES (${randomUUID()}, ${(await sql`SELECT id FROM users WHERE email = ${email}`)[0].id}, 'password_reset',
      ${authTokenHash('password_reset', resetToken)}, ${new Date(Date.now() + 60_000).toISOString()}, ${new Date().toISOString()})
  `;
  await json(await request('/api/auth/password/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: replacementPassword }),
  }), 200);
  await json(await request('/api/auth/me'), 401);
  trackAuthAttempt('login', email);
  const recoveredLogin = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email, password: replacementPassword }),
  });
  await json(recoveredLogin, 200);
  cookie = recoveredLogin.headers.get('set-cookie')?.split(';', 1)[0] ?? '';

  const setup = await json(await request('/api/auth/mfa/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: replacementPassword }),
  }), 200);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.qrDataUrl, /^data:image\/png;base64,/);
  const enabled = await json(await request('/api/auth/mfa/enable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: totp(setup.secret) }),
  }), 200);
  assert.equal(enabled.recoveryCodes.length, 8);
  await json(await request('/api/auth/logout', { method: 'POST' }), 200);
  const signedOutConsole = await request('/console');
  assert.ok([303, 307, 308].includes(signedOutConsole.status));
  const signedOutLocation = new URL(signedOutConsole.headers.get('location') ?? '/', target);
  assert.equal(signedOutLocation.pathname, '/login');
  assert.equal(signedOutLocation.searchParams.get('return_to'), '/console');
  const passwordStep = await json(await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email, password: replacementPassword }),
  }), 200);
  assert.equal(passwordStep.mfaRequired, true);
  assert.ok(passwordStep.challengeToken);
  trackAuthAttempt('mfa', passwordStep.challengeToken);
  const mfaLogin = await request('/api/auth/mfa/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken: passwordStep.challengeToken, code: totp(setup.secret, Math.floor(Date.now() / 30_000) + 1) }),
  });
  await json(mfaLogin, 200);
  cookie = mfaLogin.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const securedMe = await json(await request('/api/auth/me'), 200);
  assert.equal(securedMe.user.mfaEnabled, true);

  const accessState = await json(await request('/api/platform/access'), 200);
  const ownerMember = accessState.data.members.find((member) => member.userId === accessState.current.userId);
  assert.equal(ownerMember.role, 'owner');
  assert.equal(ownerMember.mfaEnabled, true);
  const liveReadiness = await json(await request('/api/v1/live-readiness'), 200);
  assert.equal(liveReadiness.data.liveReady, false);
  assert.equal(liveReadiness.data.fintechPath.intendedFigure, 'PSPCP');
  assert.equal(liveReadiness.data.fintechPath.metCount, 0);
  assert.ok(liveReadiness.data.rails.length >= 10);
  assert.equal(liveReadiness.data.rails.every((rail) => rail.status === 'unwired' || rail.status === 'negotiating'), true);
  assert.equal(liveReadiness.data.rails.every((rail) => rail.status !== 'live'), true);
  assert.equal(liveReadiness.data.rails.some((rail) => /bind|dock|tapi|pismo|pomelo|wibond/i.test(rail.counterparty)), false);
  assert.equal(liveReadiness.data.capitalPlan.spent >= 0, true);
  assert.equal(liveReadiness.data.capitalPlan.liveReadyAfterSpend, false);
  assert.ok(liveReadiness.data.capitalPlan.allocations.some((item) => item.id === 'legal_consult'));

  const helpPage = await request('/help');
  assert.equal(helpPage.status, 200);
  const helpHtml = await helpPage.text();
  assert.match(helpHtml, /CENTRO DE AYUDA/);
  assert.match(helpHtml, /Padrón de clientes/);
  assert.match(helpHtml, /Cuentas de producto/);
  assert.match(helpHtml, /Registro de auditoría/);
  assert.match(helpHtml, /Movimientos y transferencias/);
  assert.match(helpHtml, /Libro mayor/);
  assert.match(helpHtml, /Cash-in y cash-out/);
  assert.match(helpHtml, /Book transfers/);
  const statusPage = await request('/status');
  assert.equal(statusPage.status, 200);
  const statusHtml = await statusPage.text();
  assert.match(statusHtml, /STATUS PÚBLICO/);
  assert.match(statusHtml, /Camino PSPCP/);
  assert.match(statusHtml, /Rieles oficiales/);

  const organization = await json(await request('/api/v1/organization'), 200);
  assert.equal(organization.data.country, 'AR');
  const organizationUpdated = await json(await request('/api/v1/organization', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-org-${runId}` },
    body: JSON.stringify({ name: `Cimbra QA ${runId.slice(0, 8)}` }),
  }), 200);
  assert.equal(organizationUpdated.organization.name, `Cimbra QA ${runId.slice(0, 8)}`);
  const services = await json(await request('/api/v1/services'), 200);
  assert.ok(services.data.totals.services >= 10);
  assert.equal(services.data.totals.standalone, 0);
  const openedCase = await json(await request('/api/v1/support/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-support-${runId}` },
    body: JSON.stringify({ category: 'api', subject: 'Webhook de QA sin replay', message: 'El delivery de prueba quedó failed y necesito el request id.' }),
  }), 201);
  assert.equal(openedCase.case.status, 'open');
  const replayedCase = await json(await request('/api/v1/support/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-support-${runId}` },
    body: JSON.stringify({ category: 'api', subject: 'Webhook de QA sin replay', message: 'El delivery de prueba quedó failed y necesito el request id.' }),
  }), 200);
  assert.equal(replayedCase.replayed, true);
  assert.equal(replayedCase.case.id, openedCase.case.id);
  const listedCases = await json(await request('/api/v1/support/cases'), 200);
  assert.ok(listedCases.data.some((item) => item.id === openedCase.case.id));
  const replied = await json(await request(`/api/v1/support/cases/${openedCase.case.id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-support-msg-${runId}` },
    body: JSON.stringify({ body: 'Agrego el request id de la entrega fallida.' }),
  }), 201);
  assert.equal(replied.case.status, 'pending_cimbra');
  const resolved = await json(await request(`/api/v1/support/cases/${openedCase.case.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-support-close-${runId}` },
    body: JSON.stringify({ status: 'resolved' }),
  }), 200);
  assert.equal(resolved.case.status, 'resolved');
  const opsDenied = await json(await request('/api/ops/overview'), 403);
  assert.equal(opsDenied.error.code, 'platform_operator_required');

  const invited = await json(await request('/api/platform/access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `operator-${runId}@example.test`, role: 'operator' }),
  }), 201);
  assert.equal(invited.invitation.role, 'operator');
  await json(await request(`/api/platform/access/members/${ownerMember.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }),
  }), 409);
  await json(await request(`/api/platform/access/invitations/${invited.invitation.id}`, { method: 'DELETE' }), 200);
  const revokedAccess = await json(await request('/api/platform/access'), 200);
  assert.equal(revokedAccess.data.invitations.find((item) => item.id === invited.invitation.id).status, 'revoked');

  const adminInvitation = await json(await request('/api/platform/access', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: checkerEmail, role: 'admin' }),
  }), 201);
  assert.equal(adminInvitation.invitation.role, 'admin');
  const ownerCookie = cookie;
  cookie = '';
  trackAuthAttempt('register', checkerEmail);
  const checkerRegistration = await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Cimbra Checker', username: checkerUsername, email: checkerEmail, password: checkerPassword }),
  });
  await json(checkerRegistration, 201);
  cookie = checkerRegistration.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  await sql`UPDATE users SET email_verified = 1, updated_at = ${new Date().toISOString()} WHERE email = ${checkerEmail}`;
  assert.equal((await request('/console')).status, 200);
  const checkerSetup = await json(await request('/api/auth/mfa/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: checkerPassword }),
  }), 200);
  await json(await request('/api/auth/mfa/enable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: totp(checkerSetup.secret) }),
  }), 200);
  checkerCookie = cookie;
  const checkerAccess = await json(await request('/api/platform/access'), 200);
  assert.equal(checkerAccess.current.role, 'admin');
  cookie = ownerCookie;
  const approvalPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, expiresInMinutes: 60 }),
  }), 200);
  assert.equal(approvalPolicy.policy.enabled, true);

  const initialLedgerResponse = await request('/api/v1/ledger', { headers: { 'X-Request-Id': `qa-request-${runId}` } });
  const initialLedger = (await json(initialLedgerResponse, 200)).data;
  assert.equal(initialLedgerResponse.headers.get('x-request-id'), `qa-request-${runId}`);
  assert.equal(initialLedgerResponse.headers.get('cimbra-version'), '2026-09-01');
  const ars = initialLedger.balances.find((balance) => balance.currency === 'ARS');
  const usd = initialLedger.balances.find((balance) => balance.currency === 'USD');
  assert.deepEqual(
    { current: ars.currentMinor, held: ars.heldMinor, available: ars.availableMinor },
    { current: '516395000', held: '15000000', available: '501395000' },
  );
  assert.deepEqual(
    { current: usd.currentMinor, held: usd.heldMinor, available: usd.availableMinor },
    { current: '1000000', held: '48000', available: '952000' },
  );

  const createdKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA integration', scopes: ['ledger:read', 'customers:read', 'customers:write', 'approvals:read'], expiresInDays: 30 }),
  }), 201);
  assert.match(createdKey.secret, /^cim_sk_test_/);
  const keyList = (await json(await request('/api/platform/api-keys'), 200)).data;
  assert.equal(keyList.some((key) => key.id === createdKey.key.id), true);
  assert.equal(JSON.stringify(keyList).includes(createdKey.secret), false);
  const bearerLedger = await fetch(new URL('/api/v1/ledger', target), { headers: { Authorization: `Bearer ${createdKey.secret}` } });
  await json(bearerLedger, 200);
  assert.match(bearerLedger.headers.get('x-request-id') ?? '', /^req_[a-f0-9]{32}$/);
  assert.ok(Number(bearerLedger.headers.get('x-ratelimit-remaining')) >= 0);
  const bearerCustomerPayload = { type: 'business', name: 'QA API Company', country: 'AR', taxId: '30700111222' };
  const bearerCustomerKey = `qa-api-customer-${runId}`;
  const bearerCustomer = await json(await fetch(new URL('/api/v1/customers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${createdKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': bearerCustomerKey },
    body: JSON.stringify(bearerCustomerPayload),
  }), 201);
  assert.equal(bearerCustomer.customer.name, 'QA API Company');
  const bearerCustomerList = await json(await fetch(new URL('/api/v1/customers?limit=1', target), {
    headers: { Authorization: `Bearer ${createdKey.secret}` },
  }), 200);
  assert.equal(bearerCustomerList.data.length, 1);
  assert.equal(typeof bearerCustomerList.hasMore, 'boolean');
  const bearerCustomerRetrieved = await json(await fetch(new URL(`/api/v1/customers/${bearerCustomer.customer.id}`, target), {
    headers: { Authorization: `Bearer ${createdKey.secret}` },
  }), 200);
  assert.equal(bearerCustomerRetrieved.id, bearerCustomer.customer.id);
  const bearerCustomerReplay = await json(await fetch(new URL('/api/v1/customers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${createdKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': bearerCustomerKey },
    body: JSON.stringify(bearerCustomerPayload),
  }), 200);
  assert.equal(bearerCustomerReplay.replayed, true);
  assert.equal(bearerCustomerReplay.customer.id, bearerCustomer.customer.id);
  const bearerCustomerMismatch = await json(await fetch(new URL('/api/v1/customers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${createdKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': bearerCustomerKey },
    body: JSON.stringify({ ...bearerCustomerPayload, name: 'Different Company' }),
  }), 409);
  assert.equal(bearerCustomerMismatch.error.code, 'idempotency_mismatch');
  const deniedByScope = await json(await fetch(new URL('/api/v1/transfers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${createdKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-denied-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Supplier', description: 'Must be denied by scope', amount: '10', currency: 'ARS' }),
  }), 403);
  assert.equal(deniedByScope.error.code, 'insufficient_scope');
  await json(await request(`/api/platform/api-keys/${createdKey.key.id}`, { method: 'DELETE' }), 200);
  const revokedKey = await json(await fetch(new URL('/api/v1/ledger', target), { headers: { Authorization: `Bearer ${createdKey.secret}` } }), 401);
  assert.equal(revokedKey.error.code, 'invalid_api_key');

  const privateWebhook = await json(await request('/api/v1/webhooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Private target', url: 'https://127.0.0.1/events', eventTypes: ['transfer.created'] }),
  }), 400);
  assert.match(privateWebhook.error.message, /privada|público/);
  const webhook = await json(await request('/api/v1/webhooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA receiver', url: 'https://example.com/cimbra-qa', eventTypes: ['compliance.document_uploaded'] }),
  }), 201);
  assert.match(webhook.secret, /^whsec_/);
  const webhookList = (await json(await request('/api/v1/webhooks'), 200)).data;
  assert.equal(webhookList.endpoints.some((endpoint) => endpoint.id === webhook.endpoint.id), true);
  assert.equal(JSON.stringify(webhookList).includes(webhook.secret), false);
  const rotatedWebhook = await json(await request(`/api/v1/webhooks/${webhook.endpoint.id}/rotate`, { method: 'POST' }), 200);
  assert.match(rotatedWebhook.secret, /^whsec_/);
  assert.notEqual(rotatedWebhook.secret, webhook.secret);
  await json(await request(`/api/v1/webhooks/${webhook.endpoint.id}`, { method: 'DELETE' }), 200);

  const customerKey = `qa-customer-${runId}`;
  const customerPayload = { type: 'business', name: 'QA Company', country: 'AR', taxId: '30712345678' };
  const customer = (await json(await request('/api/v1/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': customerKey },
    body: JSON.stringify(customerPayload),
  }), 201)).customer;
  const customerReplay = await json(await request('/api/v1/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': customerKey }, body: JSON.stringify(customerPayload),
  }), 200);
  assert.equal(customerReplay.customer.id, customer.id);
  const accountKey = `qa-account-${runId}`;
  const accountPayload = { customerId: customer.id, currency: 'ARS', country: 'AR' };
  const blockedAccount = await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-account-kyc-${runId}` },
    body: JSON.stringify(accountPayload),
  }), 409);
  assert.equal(blockedAccount.error.code, 'customer_kyc_required');
  const [seedUser] = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  const [seedMember] = await sql`SELECT organization_id FROM members WHERE external_user_id = ${seedUser.id} LIMIT 1`;
  assert.ok(seedUser?.id && seedMember?.organization_id);
  userId = seedUser.id;
  organizationId = seedMember.organization_id;
  const kycNow = new Date().toISOString();
  const kycExpires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  await sql`
    INSERT INTO due_diligence_cases (
      id, organization_id, customer_id, idempotency_key, request_fingerprint, kind, jurisdiction, policy_version,
      required_checks, status, risk_rating, expires_at, created_by, resolved_by, resolution_note, resolved_at, created_at, updated_at
    ) VALUES (
      ${randomUUID()}, ${organizationId}, ${customer.id}, ${`qa-seed-kyc-${runId}`}, ${`qa-seed-fp-${runId}`},
      'kyb', 'AR', '2026-09-01', ${JSON.stringify(['business_registry', 'sanctions', 'pep', 'beneficial_ownership'])},
      'approved', 'low', ${kycExpires}, ${userId}, ${userId}, 'E2E seed approved', ${kycNow}, ${kycNow}, ${kycNow}
    )
  `;
  const account = (await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': accountKey },
    body: JSON.stringify(accountPayload),
  }), 201)).account;
  const accountReplay = await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': accountKey }, body: JSON.stringify(accountPayload),
  }), 200);
  assert.equal(accountReplay.account.id, account.id);
  const destinationAccount = (await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-account-destination-${runId}` },
    body: JSON.stringify(accountPayload),
  }), 201)).account;
  assert.notEqual(destinationAccount.id, account.id);
  const cashIn = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cashin-${runId}` },
    body: JSON.stringify({ accountId: account.id, direction: 'cash_in', counterparty: 'QA Sponsor Bank', description: 'Incoming settlement', amount: '5000.00', currency: 'ARS' }),
  }), 201);
  assert.equal(cashIn.payment.amountMinor, '500000');
  const cashInReplay = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cashin-${runId}` },
    body: JSON.stringify({ accountId: account.id, direction: 'cash_in', counterparty: 'QA Sponsor Bank', description: 'Incoming settlement', amount: '5000.00', currency: 'ARS' }),
  }), 200);
  assert.equal(cashInReplay.replayed, true);
  const cashOut = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cashout-${runId}` },
    body: JSON.stringify({ accountId: account.id, direction: 'cash_out', counterparty: 'QA Beneficiary', description: 'Outgoing payout', amount: '100.00', currency: 'ARS' }),
  }), 201);
  assert.equal(cashOut.payment.amountMinor, '-10000');
  const retrievedPayment = await json(await request(`/api/v1/payments/${cashOut.payment.id}`), 200);
  assert.equal(retrievedPayment.id, cashOut.payment.id);
  const reversibleCashOut = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cash-reversible-${runId}` },
    body: JSON.stringify({ accountId: account.id, direction: 'cash_out', counterparty: 'QA Reverse Target', description: 'Reversible cash-out', amount: '25.00', currency: 'ARS' }),
  }), 201);
  assert.equal(reversibleCashOut.payment.status, 'settled');
  const genericPaymentReverse = await json(await request(`/api/v1/transfers/${reversibleCashOut.payment.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-generic-pay-rev-${runId}` },
  }), 409);
  assert.equal(genericPaymentReverse.code, 'payment_reverse_required');
  const paymentReverse = await json(await request(`/api/v1/payments/${reversibleCashOut.payment.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-pay-rev-${runId}` },
  }), 201);
  assert.equal(paymentReverse.payment.status, 'reversed');
  assert.equal(paymentReverse.reversal.reversalOf, reversibleCashOut.payment.id);
  const paymentReverseReplay = await json(await request(`/api/v1/payments/${reversibleCashOut.payment.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-pay-rev-${runId}` },
  }), 200);
  assert.equal(paymentReverseReplay.replayed, true);

  const bookTransferKey = `qa-book-transfer-${runId}`;
  const bookTransferPayload = { externalReference: `BT-${runId}`, sourceAccountId: account.id,
    destinationAccountId: destinationAccount.id, description: 'QA internal allocation', amount: '50.00', currency: 'ARS' };
  const bookTransferCreated = await json(await request('/api/v1/book-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bookTransferKey },
    body: JSON.stringify(bookTransferPayload),
  }), 201);
  const bookTransfer = bookTransferCreated.transfer;
  assert.equal(bookTransfer.status, 'settled'); assert.equal(bookTransfer.amountMinor, '5000');
  const bookTransferReplay = await json(await request('/api/v1/book-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bookTransferKey }, body: JSON.stringify(bookTransferPayload),
  }), 200);
  assert.equal(bookTransferReplay.replayed, true); assert.equal(bookTransferReplay.transfer.id, bookTransfer.id);
  const bookTransferMismatch = await json(await request('/api/v1/book-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': bookTransferKey },
    body: JSON.stringify({ ...bookTransferPayload, amount: '51.00' }),
  }), 409);
  assert.equal(bookTransferMismatch.error.code, 'idempotency_mismatch');
  assert.equal((await json(await request(`/api/v1/book-transfers/${bookTransfer.id}`), 200)).transactionId, bookTransfer.transactionId);
  assert.ok((await json(await request('/api/v1/book-transfers?limit=10'), 200)).data.some((item) => item.id === bookTransfer.id));
  const sourceStatement = await json(await request(`/api/v1/accounts/${account.id}/statement?limit=100`), 200);
  const destinationStatement = await json(await request(`/api/v1/accounts/${destinationAccount.id}/statement?limit=100`), 200);
  assert.ok(sourceStatement.data.some((entry) => entry.transactionId === bookTransfer.transactionId && entry.signedAmountMinor === '-5000'));
  assert.ok(destinationStatement.data.some((entry) => entry.transactionId === bookTransfer.transactionId && entry.signedAmountMinor === '5000'));
  const genericBookReverseDenied = await json(await request(`/api/v1/transfers/${bookTransfer.transactionId}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-book-generic-reverse-${runId}` },
  }), 409);
  assert.equal(genericBookReverseDenied.error.code, 'book_transfer_reverse_required');
  const bookReversed = await json(await request(`/api/v1/book-transfers/${bookTransfer.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-book-reverse-${runId}` },
  }), 201);
  assert.equal(bookReversed.transfer.status, 'reversed'); assert.equal(bookReversed.reversal.reversalOf, bookTransfer.transactionId);
  const bookReverseReplay = await json(await request(`/api/v1/book-transfers/${bookTransfer.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-book-reverse-${runId}` },
  }), 200);
  assert.equal(bookReverseReplay.replayed, true);
  const destinationCashIn = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dest-cashin-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, direction: 'cash_in', counterparty: 'QA Destination Float',
      description: 'Float for QR and collections', amount: '500.00', currency: 'ARS',
    }),
  }), 201);
  assert.equal(destinationCashIn.payment.amountMinor, '50000');

  const walletProgramKey = `qa-wallet-program-${runId}`;
  const walletProgramPayload = { name: `Wallet QA ${runId}`, displayName: 'Billetera QA', defaultCurrency: 'ARS',
    allowedCurrencies: ['ARS'], pocketKinds: ['available', 'pending'] };
  const walletProgramCreated = await json(await request('/api/v1/wallet-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': walletProgramKey },
    body: JSON.stringify(walletProgramPayload),
  }), 201);
  const walletProgram = walletProgramCreated.program;
  assert.equal(walletProgram.status, 'active'); assert.deepEqual(walletProgram.pocketKinds, ['available', 'pending']);
  const walletProgramReplay = await json(await request('/api/v1/wallet-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': walletProgramKey },
    body: JSON.stringify(walletProgramPayload),
  }), 200);
  assert.equal(walletProgramReplay.replayed, true); assert.equal(walletProgramReplay.program.id, walletProgram.id);
  assert.equal((await json(await request(`/api/v1/wallet-programs/${walletProgram.id}`), 200)).id, walletProgram.id);
  const walletKey = `qa-wallet-${runId}`;
  const walletPayload = { programId: walletProgram.id, customerId: customer.id, externalReference: `WALLET-${runId}` };
  const walletCreated = await json(await request('/api/v1/wallets', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': walletKey },
    body: JSON.stringify(walletPayload),
  }), 201);
  const wallet = walletCreated.wallet;
  assert.equal(wallet.status, 'active'); assert.equal(walletCreated.pockets.length, 2);
  const walletReplay = await json(await request('/api/v1/wallets', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': walletKey },
    body: JSON.stringify(walletPayload),
  }), 200);
  assert.equal(walletReplay.replayed, true); assert.equal(walletReplay.wallet.id, wallet.id);
  const retrievedWallet = await json(await request(`/api/v1/wallets/${wallet.id}`), 200);
  assert.equal(retrievedWallet.pockets.length, 2);
  const availablePocket = retrievedWallet.pockets.find((pocket) => pocket.kind === 'available');
  const pendingPocket = retrievedWallet.pockets.find((pocket) => pocket.kind === 'pending');
  assert.ok(availablePocket && pendingPocket);
  const walletCashIn = await json(await request('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-wallet-cashin-${runId}` },
    body: JSON.stringify({ accountId: availablePocket.accountId, direction: 'cash_in', counterparty: 'QA Wallet Sponsor',
      description: 'Wallet funding', amount: '80.00', currency: 'ARS' }),
  }), 201);
  assert.equal(walletCashIn.payment.status, 'settled');
  const pocketTransferKey = `qa-wallet-transfer-${runId}`;
  const pocketTransferPayload = { externalReference: `WP-${runId}`, sourcePocketId: availablePocket.id,
    destinationPocketId: pendingPocket.id, description: 'QA pocket allocation', amount: '25.00', currency: 'ARS' };
  const pocketTransferCreated = await json(await request(`/api/v1/wallets/${wallet.id}/transfers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pocketTransferKey },
    body: JSON.stringify(pocketTransferPayload),
  }), 201);
  assert.equal(pocketTransferCreated.transfer.status, 'settled');
  const pocketTransferReplay = await json(await request(`/api/v1/wallets/${wallet.id}/transfers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pocketTransferKey },
    body: JSON.stringify(pocketTransferPayload),
  }), 200);
  assert.equal(pocketTransferReplay.replayed, true);
  const frozen = await json(await request(`/api/v1/wallets/${wallet.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-wallet-freeze-${runId}` },
    body: JSON.stringify({ status: 'frozen', reason: 'internal_control' }),
  }), 200);
  assert.equal(frozen.event.toStatus, 'frozen');
  const frozenTransferDenied = await json(await request(`/api/v1/wallets/${wallet.id}/transfers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-wallet-frozen-transfer-${runId}` },
    body: JSON.stringify({ ...pocketTransferPayload, externalReference: `WP-FROZEN-${runId}`, amount: '1.00' }),
  }), 409);
  assert.equal(frozenTransferDenied.error.code, 'wallet_inactive');
  await json(await request(`/api/v1/wallets/${wallet.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-wallet-unfreeze-${runId}` },
    body: JSON.stringify({ status: 'active', reason: 'review_cleared' }),
  }), 200);
  const closeWithBalance = await json(await request(`/api/v1/wallets/${wallet.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-wallet-close-balance-${runId}` },
    body: JSON.stringify({ status: 'closed', reason: 'customer_request' }),
  }), 409);
  assert.equal(closeWithBalance.error.code, 'wallet_has_balance');
  assert.ok((await json(await request('/api/v1/wallets?limit=10'), 200)).data.some((item) => item.id === wallet.id));
  assert.ok((await json(await request(`/api/v1/wallets/${wallet.id}/lifecycle`), 200)).data.some((event) => event.toStatus === 'frozen'));

  const alias = `QAINST${runId.replaceAll('-', '').slice(0, 8)}`.toUpperCase();
  const issuedSource = await json(await request('/api/v1/rail-instruments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cvu-source-${runId}` },
    body: JSON.stringify({ accountId: account.id, alias }),
  }), 201);
  assert.equal(issuedSource.instruments.length, 2);
  assert.match(issuedSource.instruments.find((item) => item.kind === 'cvu').value, /^0009999/);
  const issuedSourceReplay = await json(await request('/api/v1/rail-instruments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cvu-source-${runId}` },
    body: JSON.stringify({ accountId: account.id, alias }),
  }), 200);
  assert.equal(issuedSourceReplay.replayed, true);
  const issuedDestination = await json(await request('/api/v1/rail-instruments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cvu-dest-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id }),
  }), 201);
  const destinationCvu = issuedDestination.instruments.find((item) => item.kind === 'cvu');
  const destAlias = `QADEST${runId.replaceAll('-', '').slice(0, 8)}`.toUpperCase();
  const assignKey = `qa-alias-assign-${runId}`;
  const assigned = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': assignKey },
    body: JSON.stringify({ alias: destAlias }),
  }), 200);
  assert.equal(assigned.replayed, false);
  assert.equal(assigned.instruments.find((item) => item.kind === 'alias').value, destAlias);
  const assignedReplay = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': assignKey },
    body: JSON.stringify({ alias: destAlias }),
  }), 200);
  assert.equal(assignedReplay.replayed, true);
  const aliasConflict = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-alias-conflict-${runId}` },
    body: JSON.stringify({ alias }),
  }), 422);
  assert.equal(aliasConflict.error.code, 'alias_conflict');
  const changedAlias = `QACHG${runId.replaceAll('-', '').slice(0, 8)}`.toUpperCase();
  const changed = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-alias-change-${runId}` },
    body: JSON.stringify({ alias: changedAlias }),
  }), 200);
  assert.equal(changed.instruments.find((item) => item.kind === 'alias').value, changedAlias);
  const rateLimited = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-alias-rate-${runId}` },
    body: JSON.stringify({ alias: `QA2ND${runId.replaceAll('-', '').slice(0, 8)}` }),
  }), 422);
  assert.equal(rateLimited.error.code, 'alias_change_rate_limited');
  const sameAlias = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-alias-same-${runId}` },
    body: JSON.stringify({ alias: changedAlias }),
  }), 200);
  assert.equal(sameAlias.replayed, false);
  const destinationCvuValue = destinationCvu.value;
  const directory = await json(await request(`/api/v1/rail-directory?q=${destinationCvuValue}`), 200);
  assert.equal(directory.found, true); assert.equal(directory.holderName, 'QA Company'); assert.equal(directory.taxIdLast4, '5678');
  const holderMismatch = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ip-mismatch-${runId}` },
    body: JSON.stringify({
      externalReference: `IP-MIS-${runId}`, accountId: account.id, destination: destinationCvuValue, description: 'Mismatch',
      amount: '10.00', currency: 'ARS', confirmHolder: true, holderName: 'Otro Titular', taxIdLast4: '0000',
    }),
  }), 422);
  assert.equal(holderMismatch.error.code, 'holder_mismatch');
  const internalKey = `qa-ip-internal-${runId}`;
  const internalPayload = {
    externalReference: `IP-IN-${runId}`, accountId: account.id, destination: destinationCvuValue, description: 'Crédito interno AR',
    amount: '25.00', currency: 'ARS', confirmHolder: true, holderName: 'QA Company', taxIdLast4: '5678',
  };
  const internalCreated = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': internalKey },
    body: JSON.stringify(internalPayload),
  }), 201);
  assert.equal(internalCreated.transfer.status, 'settled'); assert.equal(internalCreated.transfer.direction, 'internal');
  const internalReplay = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': internalKey },
    body: JSON.stringify(internalPayload),
  }), 200);
  assert.equal(internalReplay.replayed, true);
  const outbound = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ip-out-${runId}` },
    body: JSON.stringify({
      externalReference: `IP-OUT-${runId}`, accountId: account.id, destination: '0110023500000000012342', description: 'Cash-out sandbox',
      amount: '15.00', currency: 'ARS', confirmHolder: true, holderName: 'Banco Ejemplo', taxIdLast4: '1111',
    }),
  }), 201);
  assert.equal(outbound.transfer.direction, 'outbound'); assert.equal(outbound.transfer.status, 'settled');
  const inbound = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ip-in-${runId}` },
    body: JSON.stringify({
      externalReference: `IP-INB-${runId}`, accountId: account.id, destination: '0110023500000000012342', description: 'Inbound sandbox',
      amount: '12.00', currency: 'ARS', direction: 'inbound', confirmHolder: true, holderName: 'Originador', taxIdLast4: '2222',
    }),
  }), 201);
  assert.equal(inbound.transfer.direction, 'inbound');
  const externalDebit = await json(await request('/api/v1/debit-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debit-ext-${runId}` },
    body: JSON.stringify({
      externalReference: `DB-EXT-${runId}`, collectorAccountId: account.id, payerDestination: '0110023500000000012342',
      description: 'DEBIN externo', amount: '5.00', currency: 'ARS',
    }),
  }), 422);
  assert.equal(externalDebit.error.code, 'external_debit_not_supported');
  const debitCreated = await json(await request('/api/v1/debit-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debit-${runId}` },
    body: JSON.stringify({
      externalReference: `DB-${runId}`, collectorAccountId: account.id, payerDestination: destinationCvuValue,
      description: 'Débito interno', amount: '8.00', currency: 'ARS',
    }),
  }), 201);
  assert.equal(debitCreated.debit.status, 'pending');
  const debitAccepted = await json(await request(`/api/v1/debit-requests/${debitCreated.debit.id}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debit-accept-${runId}` },
    body: JSON.stringify({ decision: 'accept' }),
  }), 201);
  assert.equal(debitAccepted.debit.status, 'settled');
  const qrCreated = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-${runId}` },
    body: JSON.stringify({ accountId: account.id, description: 'Mostrador QA', amount: '6.00', currency: 'ARS' }),
  }), 201);
  assert.match(qrCreated.qr.payload, /^cimbra:qr:v1:/);
  assert.equal(qrCreated.qr.kind, 'dynamic');
  const qrPaid = await json(await request(`/api/v1/payment-qrs/${qrCreated.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-pay-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-${runId}` }),
  }), 201);
  assert.equal(qrPaid.transfer.scheme, 'qr_collect'); assert.equal(qrPaid.transfer.status, 'settled');
  const staticQr = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-${runId}` },
    body: JSON.stringify({ accountId: account.id, description: 'Caja QA', kind: 'static' }),
  }), 201);
  assert.match(staticQr.qr.payload, /^cimbra:qr:static:v1:/);
  assert.equal(staticQr.qr.kind, 'static');
  assert.equal(staticQr.qr.expiresAt, null);
  assert.equal(staticQr.qr.status, 'active');
  const staticPayOne = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-pay-1-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-ST-1-${runId}`, amount: '3.00' }),
  }), 201);
  assert.equal(staticPayOne.transfer.status, 'settled');
  const listedAfterPay = await json(await request('/api/v1/payment-qrs?limit=50'), 200);
  assert.equal(listedAfterPay.data.find((item) => item.id === staticQr.qr.id).status, 'active');
  const staticPayTwo = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-pay-2-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-ST-2-${runId}`, amount: '4.00' }),
  }), 201);
  assert.equal(staticPayTwo.transfer.status, 'settled');
  const saleOnDynamic = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-dyn-${runId}` },
    body: JSON.stringify({
      paymentQrId: qrCreated.qr.id, externalReference: `OV-DYN-${runId}`, description: 'No aplica', amount: '5.00', currency: 'ARS',
    }),
  }), 422);
  assert.equal(saleOnDynamic.error.code, 'sale_order_requires_static_qr');
  const saleKey = `qa-ov-${runId}`;
  const salePayload = {
    paymentQrId: staticQr.qr.id, externalReference: `OV-${runId}`, description: 'Mostrador cerrado', amount: '7.00', currency: 'ARS',
  };
  const saleCreated = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saleKey },
    body: JSON.stringify(salePayload),
  }), 201);
  assert.equal(saleCreated.order.status, 'pending');
  assert.equal(saleCreated.order.amount, 7);
  const saleReplay = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saleKey },
    body: JSON.stringify(salePayload),
  }), 200);
  assert.equal(saleReplay.replayed, true);
  const retrievedSale = await json(await request(`/api/v1/qr-sale-orders/${saleCreated.order.id}`), 200);
  assert.equal(retrievedSale.id, saleCreated.order.id);
  const saleMismatch = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-mismatch-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-OV-MIS-${runId}`, amount: '9.00' }),
  }), 422);
  assert.equal(saleMismatch.error.code, 'sale_order_amount_mismatch');
  const salePaid = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-pay-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-OV-${runId}` }),
  }), 201);
  assert.equal(salePaid.transfer.status, 'settled');
  assert.equal(salePaid.transfer.amount, 7);
  const paidSale = await json(await request(`/api/v1/qr-sale-orders/${saleCreated.order.id}`), 200);
  assert.equal(paidSale.status, 'paid');
  const listedAfterSale = await json(await request('/api/v1/payment-qrs?limit=50'), 200);
  assert.equal(listedAfterSale.data.find((item) => item.id === staticQr.qr.id).status, 'active');
  const saleFirst = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-a-${runId}` },
    body: JSON.stringify({
      paymentQrId: staticQr.qr.id, externalReference: `OV-A-${runId}`, description: 'Primera', amount: '2.00', currency: 'ARS',
    }),
  }), 201);
  const saleSecond = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-b-${runId}` },
    body: JSON.stringify({
      paymentQrId: staticQr.qr.id, externalReference: `OV-B-${runId}`, description: 'Segunda', amount: '3.00', currency: 'ARS',
    }),
  }), 201);
  assert.equal(saleSecond.order.status, 'pending');
  assert.equal((await json(await request(`/api/v1/qr-sale-orders/${saleFirst.order.id}`), 200)).status, 'superseded');
  const saleCancelKey = `qa-ov-del-${runId}`;
  const saleCancelled = await json(await request(`/api/v1/qr-sale-orders/${saleSecond.order.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': saleCancelKey },
  }), 200);
  assert.equal(saleCancelled.order.status, 'cancelled');
  const saleCancelledReplay = await json(await request(`/api/v1/qr-sale-orders/${saleSecond.order.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': saleCancelKey },
  }), 200);
  assert.equal(saleCancelledReplay.replayed, true);
  const openAfterCancel = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-open-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-OV-OPEN-${runId}`, amount: '1.50' }),
  }), 201);
  assert.equal(openAfterCancel.transfer.amount, 1.5);
  const debtViaQr = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-debt-kind-${runId}` },
    body: JSON.stringify({ accountId: account.id, description: 'Deuda vía QR', kind: 'debt', amount: '6.00' }),
  }), 400);
  assert.equal(debtViaQr.error.code, 'invalid_payment_qr');
  const debtKey = `qa-debt-${runId}`;
  const debtPayload = {
    accountId: destinationAccount.id, externalReference: `DEUDA-${runId}`, description: 'Cuota única QA', amount: '6.00', currency: 'ARS',
  };
  const debtCreated = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': debtKey },
    body: JSON.stringify(debtPayload),
  }), 201);
  assert.equal(debtCreated.debt.status, 'open');
  assert.equal(debtCreated.debt.amount, 6);
  assert.match(debtCreated.debt.payload, /^cimbra:qr:debt:v1:/);
  const debtReplay = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': debtKey },
    body: JSON.stringify(debtPayload),
  }), 200);
  assert.equal(debtReplay.replayed, true);
  const retrievedDebt = await json(await request(`/api/v1/qr-debts/${debtCreated.debt.id}`), 200);
  assert.equal(retrievedDebt.id, debtCreated.debt.id);
  const saleOnDebt = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ov-debt-${runId}` },
    body: JSON.stringify({
      paymentQrId: debtCreated.debt.paymentQrId, externalReference: `OV-DEBT-${runId}`, description: 'No aplica',
      amount: '5.00', currency: 'ARS',
    }),
  }), 422);
  assert.equal(saleOnDebt.error.code, 'sale_order_requires_static_qr');
  const debtMismatch = await json(await request(`/api/v1/payment-qrs/${debtCreated.debt.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debt-mismatch-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `QR-DEBT-MIS-${runId}`, amount: '9.00' }),
  }), 422);
  assert.equal(debtMismatch.error.code, 'qr_amount_mismatch');
  const debtPaid = await json(await request(`/api/v1/payment-qrs/${debtCreated.debt.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debt-pay-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `QR-DEBT-${runId}` }),
  }), 201);
  assert.equal(debtPaid.transfer.status, 'settled');
  assert.equal(debtPaid.transfer.amount, 6);
  const paidDebt = await json(await request(`/api/v1/qr-debts/${debtCreated.debt.id}`), 200);
  assert.equal(paidDebt.status, 'paid');
  const listedAfterDebt = await json(await request('/api/v1/payment-qrs?limit=50'), 200);
  assert.equal(listedAfterDebt.data.find((item) => item.id === debtCreated.debt.paymentQrId).status, 'paid');
  const debtRepay = await json(await request(`/api/v1/payment-qrs/${debtCreated.debt.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debt-repay-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `QR-DEBT-2-${runId}` }),
  }), 409);
  assert.equal(debtRepay.error.code, 'qr_not_active');
  const debtCancelPayload = {
    accountId: destinationAccount.id, externalReference: `DEUDA-DEL-${runId}`, description: 'Eliminar', amount: '2.00', currency: 'ARS',
  };
  const debtToCancel = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debt-del-create-${runId}` },
    body: JSON.stringify(debtCancelPayload),
  }), 201);
  const debtCancelKey = `qa-debt-del-${runId}`;
  const debtCancelled = await json(await request(`/api/v1/qr-debts/${debtToCancel.debt.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': debtCancelKey },
  }), 200);
  assert.equal(debtCancelled.debt.status, 'cancelled');
  const debtCancelledReplay = await json(await request(`/api/v1/qr-debts/${debtToCancel.debt.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': debtCancelKey },
  }), 200);
  assert.equal(debtCancelledReplay.replayed, true);
  const payCancelledDebt = await json(await request(`/api/v1/payment-qrs/${debtToCancel.debt.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-debt-pay-dead-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `QR-DEBT-DEAD-${runId}` }),
  }), 409);
  assert.equal(payCancelledDebt.error.code, 'qr_not_active');
  const duplicateStatic = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-dup-${runId}` },
    body: JSON.stringify({ accountId: account.id, description: 'Caja duplicada', kind: 'static' }),
  }), 409);
  assert.equal(duplicateStatic.error.code, 'static_qr_already_active');
  const cancelKey = `qa-qr-cancel-${runId}`;
  const cancelled = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': cancelKey },
  }), 201);
  assert.equal(cancelled.qr.status, 'cancelled');
  assert.equal(cancelled.replayed, false);
  const cancelledReplay = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': cancelKey },
  }), 200);
  assert.equal(cancelledReplay.replayed, true);
  const payCancelled = await json(await request(`/api/v1/payment-qrs/${staticQr.qr.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-pay-dead-${runId}` },
    body: JSON.stringify({ sourceAccountId: destinationAccount.id, externalReference: `QR-ST-DEAD-${runId}`, amount: '1.00' }),
  }), 409);
  assert.equal(payCancelled.error.code, 'qr_not_active');
  const staticAgain = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-qr-static-2-${runId}` },
    body: JSON.stringify({ accountId: account.id, description: 'Caja reemplazo', kind: 'static' }),
  }), 201);
  assert.equal(staticAgain.qr.status, 'active');
  const returned = await json(await request(`/api/v1/instant-transfers/${outbound.transfer.id}/return`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-ip-return-${runId}` },
  }), 201);
  assert.equal(returned.transfer.status, 'returned');
  assert.ok((await json(await request('/api/v1/rail-instruments?limit=10'), 200)).data.some((item) => item.kind === 'cvu'));
  assert.ok((await json(await request('/api/v1/instant-transfers?limit=10'), 200)).data.some((item) => item.id === outbound.transfer.id));
  const revokeKey = `qa-cvu-revoke-${runId}`;
  const revoked = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': revokeKey },
  }), 200);
  assert.equal(revoked.replayed, false);
  assert.equal(revoked.instruments.find((item) => item.kind === 'cvu').status, 'revoked');
  const revokedReplay = await json(await request(`/api/v1/rail-instruments/${destinationCvu.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': revokeKey },
  }), 200);
  assert.equal(revokedReplay.replayed, true);
  const revokedTransfer = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-ip-revoked-${runId}` },
    body: JSON.stringify({
      externalReference: `IP-REV-${runId}`, accountId: account.id, destination: destinationCvuValue, description: 'CVU eliminado',
      amount: '1.00', currency: 'ARS', confirmHolder: true, holderName: 'QA Company', taxIdLast4: '5678',
    }),
  }), 404);
  assert.equal(revokedTransfer.error.code, 'unknown_sandbox_cvu');
  const revokedDirectory = await json(await request(`/api/v1/rail-directory?q=${destinationCvuValue}`), 200);
  assert.equal(revokedDirectory.found, false);
  const reissued = await json(await request('/api/v1/rail-instruments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-cvu-dest-reissue-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id }),
  }), 201);
  assert.equal(reissued.instruments.find((item) => item.kind === 'cvu').value, destinationCvuValue);
  assert.equal(reissued.instruments.find((item) => item.kind === 'cvu').status, 'active');
  assert.equal((await json(await request(`/api/v1/rail-directory?q=${destinationCvuValue}`), 200)).found, true);

  const linkKey = `qa-link-${runId}`;
  const linkPayload = {
    accountId: destinationAccount.id, externalReference: `FAC-${runId}`, description: 'Honorarios QA',
    amount: '18.00', currency: 'ARS', methods: ['internal', 'sandbox_inbound'],
  };
  const linkCreated = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': linkKey },
    body: JSON.stringify(linkPayload),
  }), 201);
  assert.equal(linkCreated.link.status, 'open'); assert.match(linkCreated.link.payload, /^cimbra:link:v1:/);
  const linkReplay = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': linkKey },
    body: JSON.stringify(linkPayload),
  }), 200);
  assert.equal(linkReplay.replayed, true);
  const cardDenied = await json(await request(`/api/v1/payment-links/${linkCreated.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-card-${runId}` },
    body: JSON.stringify({ method: 'card' }),
  }), 422);
  assert.equal(cardDenied.error.code, 'card_acquiring_not_supported');
  const payKey = `qa-link-pay-${runId}`;
  const paid = await json(await request(`/api/v1/payment-links/${linkCreated.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payKey },
    body: JSON.stringify({ method: 'internal', payerAccountId: account.id }),
  }), 201);
  assert.equal(paid.link.status, 'paid'); assert.equal(paid.link.paidMethod, 'internal');
  const paidReplay = await json(await request(`/api/v1/payment-links/${linkCreated.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': payKey },
    body: JSON.stringify({ method: 'internal', payerAccountId: account.id }),
  }), 200);
  assert.equal(paidReplay.replayed, true);
  const refunded = await json(await request(`/api/v1/payment-links/${linkCreated.link.id}/refund`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-link-refund-${runId}` },
  }), 201);
  assert.equal(refunded.link.status, 'refunded');
  const inboundLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-in-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-IN-${runId}`, description: 'Inbound QA',
      amount: '9.00', currency: 'ARS', methods: ['sandbox_inbound'],
    }),
  }), 201);
  const inboundPaid = await json(await request(`/api/v1/payment-links/${inboundLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-in-pay-${runId}` },
    body: JSON.stringify({ method: 'sandbox_inbound' }),
  }), 201);
  assert.equal(inboundPaid.link.status, 'paid'); assert.equal(inboundPaid.link.paidMethod, 'sandbox_inbound');
  const cancelledLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cancel-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-CAN-${runId}`, description: 'Cancelable',
      amount: '4.00', currency: 'ARS',
    }),
  }), 201);
  const cancelledPaymentLink = await json(await request(`/api/v1/payment-links/${cancelledLink.link.id}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-link-cancel-exec-${runId}` },
  }), 201);
  assert.equal(cancelledPaymentLink.link.status, 'cancelled');
  assert.ok((await json(await request('/api/v1/payment-links?limit=10'), 200)).data.some((item) => item.id === linkCreated.link.id));

  const tillStatic = await json(await request('/api/v1/payment-qrs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-static-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, description: 'QR till QA', kind: 'static' }),
  }), 201);
  const tillPayload = {
    accountId: destinationAccount.id, externalReference: `TILL-${runId}`, name: 'Mostrador Sur',
    paymentQrId: tillStatic.qr.id,
  };
  const tillCreated = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-${runId}` },
    body: JSON.stringify(tillPayload),
  }), 201);
  assert.equal(tillCreated.till.status, 'active');
  assert.equal(tillCreated.till.paymentQrId, tillStatic.qr.id);
  assert.match(tillCreated.till.cvu, /^0009999/);
  assert.notEqual(tillCreated.till.cvu, destinationCvuValue);
  const tillReplay = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-${runId}` },
    body: JSON.stringify(tillPayload),
  }), 200);
  assert.equal(tillReplay.replayed, true); assert.equal(tillReplay.till.id, tillCreated.till.id);
  const retrievedTill = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}`), 200);
  assert.equal(retrievedTill.id, tillCreated.till.id);
  const tillDirectory = await json(await request(`/api/v1/rail-directory?q=${tillCreated.till.cvu}`), 200);
  assert.equal(tillDirectory.found, true); assert.equal(tillDirectory.holderName, 'QA Company');
  const tillInbound = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/inbound`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-in-${runId}` },
    body: JSON.stringify({
      externalReference: `TILL-IN-${runId}`, description: 'Acreditación till', amount: '11.00', currency: 'ARS',
    }),
  }), 201);
  assert.equal(tillInbound.transfer.direction, 'inbound');
  assert.equal(tillInbound.transfer.collectionTillId, tillCreated.till.id);
  assert.equal(tillInbound.transfer.destinationAccountId, destinationAccount.id);
  const tillInboundReplay = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/inbound`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-in-${runId}` },
    body: JSON.stringify({
      externalReference: `TILL-IN-${runId}`, description: 'Acreditación till', amount: '11.00', currency: 'ARS',
    }),
  }), 200);
  assert.equal(tillInboundReplay.replayed, true);
  const tillInternal = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-push-${runId}` },
    body: JSON.stringify({
      externalReference: `TILL-PUSH-${runId}`, accountId: account.id, destination: tillCreated.till.cvu,
      description: 'Pago a till', amount: '5.00', currency: 'ARS', confirmHolder: true, holderName: 'QA Company', taxIdLast4: '5678',
    }),
  }), 201);
  assert.equal(tillInternal.transfer.direction, 'internal');
  assert.equal(tillInternal.transfer.collectionTillId, tillCreated.till.id);
  const tillAlias = `TILL.${runId.replaceAll('-', '').slice(0, 14)}`.toUpperCase();
  const tillAliased = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-alias-${runId}` },
    body: JSON.stringify({ alias: tillAlias }),
  }), 200);
  assert.equal(tillAliased.till.alias, tillAlias);
  const tillAliasReplay = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/alias`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-alias-${runId}` },
    body: JSON.stringify({ alias: tillAlias }),
  }), 200);
  assert.equal(tillAliasReplay.replayed, true);
  const tillAliasDirectory = await json(await request(`/api/v1/rail-directory?q=${encodeURIComponent(tillAlias)}`), 200);
  assert.equal(tillAliasDirectory.found, true);
  const alreadyIssued = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/static-qr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-qr-dup-${runId}` },
    body: JSON.stringify({}),
  }), 409);
  assert.equal(alreadyIssued.error.code, 'till_qr_already_issued');
  const tillQrPayload = {
    accountId: destinationAccount.id, externalReference: `TILL-QR-${runId}`, name: 'Caja QR',
    issueStaticQr: true, closedAmountOnly: true, presence: 'present',
  };
  const tillWithQr = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-qr-${runId}` },
    body: JSON.stringify(tillQrPayload),
  }), 201);
  assert.equal(tillWithQr.till.closedAmountOnly, true);
  assert.equal(tillWithQr.till.presence, 'present');
  assert.ok(tillWithQr.till.paymentQrId);
  assert.match(tillWithQr.till.qrPayload, /^cimbra:qr:static:v1:/);
  const tillWithQrReplay = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-qr-${runId}` },
    body: JSON.stringify(tillQrPayload),
  }), 200);
  assert.equal(tillWithQrReplay.replayed, true);
  const openAmountDenied = await json(await request(`/api/v1/payment-qrs/${tillWithQr.till.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-qr-open-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `TILL-QR-OPEN-${runId}`, amount: '4.00' }),
  }), 409);
  assert.equal(openAmountDenied.error.code, 'sale_order_required');
  const tillSale = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-ov-${runId}` },
    body: JSON.stringify({
      paymentQrId: tillWithQr.till.paymentQrId, externalReference: `OV-TILL-${runId}`,
      description: 'Ticket till', amount: '4.00', currency: 'ARS',
    }),
  }), 201);
  assert.equal(tillSale.order.status, 'pending');
  const tillQrPaid = await json(await request(`/api/v1/payment-qrs/${tillWithQr.till.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-qr-pay-${runId}` },
    body: JSON.stringify({ sourceAccountId: account.id, externalReference: `TILL-QR-PAY-${runId}`, amount: '4.00' }),
  }), 201);
  assert.equal(tillQrPaid.transfer.collectionTillId, tillWithQr.till.id);
  const cancelTillQr = await json(await request(`/api/v1/payment-qrs/${tillWithQr.till.paymentQrId}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-till-qr-cancel-${runId}` },
  }), 409);
  assert.equal(cancelTillQr.error.code, 'till_qr_immutable');
  const tillBare = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-bare-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `TILL-BARE-${runId}`, name: 'Caja sin QR',
    }),
  }), 201);
  const issuedLater = await json(await request(`/api/v1/collection-tills/${tillBare.till.id}/static-qr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-issue-${runId}` },
    body: JSON.stringify({}),
  }), 201);
  assert.ok(issuedLater.till.paymentQrId);
  assert.match(issuedLater.till.qrPayload, /^cimbra:qr:static:v1:/);
  const issuedLaterReplay = await json(await request(`/api/v1/collection-tills/${tillBare.till.id}/static-qr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-issue-${runId}` },
    body: JSON.stringify({}),
  }), 200);
  assert.equal(issuedLaterReplay.replayed, true);
  const tillDisabled = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': `qa-till-off-${runId}` },
  }), 200);
  assert.equal(tillDisabled.till.status, 'disabled');
  const tillDisabledReplay = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}`, {
    method: 'DELETE', headers: { 'Idempotency-Key': `qa-till-off-${runId}` },
  }), 200);
  assert.equal(tillDisabledReplay.replayed, true);
  const tillInboundOff = await json(await request(`/api/v1/collection-tills/${tillCreated.till.id}/inbound`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-in-off-${runId}` },
    body: JSON.stringify({
      externalReference: `TILL-OFF-${runId}`, description: 'Ya deshabilitado', amount: '1.00', currency: 'ARS',
    }),
  }), 409);
  assert.equal(tillInboundOff.error.code, 'collection_till_disabled');
  const tillPushOff = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-till-push-off-${runId}` },
    body: JSON.stringify({
      externalReference: `TILL-PUSH-OFF-${runId}`, accountId: account.id, destination: tillCreated.till.cvu,
      description: 'Pago a till muerto', amount: '1.00', currency: 'ARS', confirmHolder: true, holderName: 'QA Company', taxIdLast4: '5678',
    }),
  }), 404);
  assert.equal(tillPushOff.error.code, 'unknown_sandbox_cvu');
  assert.ok((await json(await request('/api/v1/collection-tills?limit=10'), 200)).data.some((item) => item.id === tillCreated.till.id));

  const linkedDebt = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-debt-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `DEUDA-LINK-${runId}`, description: 'Deuda del link',
      amount: '7.00', currency: 'ARS',
    }),
  }), 201);
  const linkedTill = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-till-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `TILL-LINK-${runId}`, name: 'Caja link',
    }),
  }), 201);
  const missingDebt = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-qr-missing-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-QR-MISS-${runId}`, description: 'Sin deuda',
      amount: '7.00', currency: 'ARS', methods: ['cimbra_qr'],
    }),
  }), 400);
  assert.equal(missingDebt.error.code, 'invalid_payment_link');
  const debtLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-qr-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-QR-${runId}`, description: 'Link con deuda',
      amount: '7.00', currency: 'ARS', methods: ['cimbra_qr'], qrDebtId: linkedDebt.debt.id,
    }),
  }), 201);
  assert.equal(debtLink.link.qrDebtId, linkedDebt.debt.id);
  assert.match(debtLink.link.qrPayload, /^cimbra:qr:debt:v1:/);
  const duplicateDebtLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-qr-dup-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-QR-DUP-${runId}`, description: 'Misma deuda',
      amount: '7.00', currency: 'ARS', methods: ['cimbra_qr'], qrDebtId: linkedDebt.debt.id,
    }),
  }), 409);
  assert.equal(duplicateDebtLink.error.code, 'qr_debt_link_conflict');
  const paidDebtLink = await json(await request(`/api/v1/payment-links/${debtLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-qr-pay-${runId}` },
    body: JSON.stringify({ method: 'cimbra_qr', payerAccountId: account.id }),
  }), 201);
  assert.equal(paidDebtLink.link.status, 'paid'); assert.equal(paidDebtLink.link.paidMethod, 'cimbra_qr');
  const settledDebt = await json(await request(`/api/v1/qr-debts/${linkedDebt.debt.id}`), 200);
  assert.equal(settledDebt.status, 'paid');
  const syncDebt = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-debt-sync-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `DEUDA-SYNC-${runId}`, description: 'Deuda sincronizada',
      amount: '5.00', currency: 'ARS',
    }),
  }), 201);
  const syncLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-sync-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-SYNC-${runId}`, description: 'Link sincronizado',
      amount: '5.00', currency: 'ARS', methods: ['cimbra_qr'], qrDebtId: syncDebt.debt.id,
    }),
  }), 201);
  const syncQrPaid = await json(await request(`/api/v1/payment-qrs/${syncDebt.debt.paymentQrId}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-sync-pay-${runId}` },
    body: JSON.stringify({
      sourceAccountId: account.id, externalReference: `QR-SYNC-${runId}`,
    }),
  }), 201);
  assert.equal(syncQrPaid.transfer.status, 'settled');
  const synced = await json(await request(`/api/v1/payment-links/${syncLink.link.id}`), 200);
  assert.equal(synced.status, 'paid'); assert.equal(synced.paidMethod, 'cimbra_qr');
  const cvuLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-CVU-${runId}`, description: 'Link con till',
      amount: '8.00', currency: 'ARS', methods: ['cimbra_cvu'], collectionTillId: linkedTill.till.id,
    }),
  }), 201);
  assert.equal(cvuLink.link.collectionTillId, linkedTill.till.id); assert.equal(cvuLink.link.cvu, linkedTill.till.cvu);
  const paidCvuLink = await json(await request(`/api/v1/payment-links/${cvuLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-pay-${runId}` },
    body: JSON.stringify({ method: 'cimbra_cvu', payerAccountId: account.id }),
  }), 201);
  assert.equal(paidCvuLink.link.status, 'paid'); assert.equal(paidCvuLink.link.paidMethod, 'cimbra_cvu');
  assert.equal(paidCvuLink.link.collectedAmount, 8); assert.equal(paidCvuLink.link.remainingAmount, 0);
  const inboundCvuLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-in-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-CVU-IN-${runId}`, description: 'Link inbound till',
      amount: '3.00', currency: 'ARS', methods: ['cimbra_cvu'], collectionTillId: linkedTill.till.id,
    }),
  }), 201);
  const inboundCvuPaid = await json(await request(`/api/v1/payment-links/${inboundCvuLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-in-pay-${runId}` },
    body: JSON.stringify({ method: 'cimbra_cvu' }),
  }), 201);
  assert.equal(inboundCvuPaid.link.status, 'paid'); assert.equal(inboundCvuPaid.link.paidMethod, 'cimbra_cvu');
  const partialCvuLink = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-CVU-PART-${runId}`, description: 'Link parcial CVU',
      amount: '8.00', currency: 'ARS', methods: ['cimbra_cvu'], collectionTillId: linkedTill.till.id,
      items: [
        { description: 'Honorarios', amount: '5.00', quantity: 1 },
        { description: 'Gastos', amount: '3.00', quantity: 1 },
      ],
    }),
  }), 201);
  assert.equal(partialCvuLink.link.collectedAmount, 0); assert.equal(partialCvuLink.link.remainingAmount, 8);
  assert.equal(partialCvuLink.link.partiallyCollected, false);
  assert.equal(partialCvuLink.link.items.length, 2);
  assert.equal(partialCvuLink.link.items[0].description, 'Honorarios');
  assert.equal(partialCvuLink.link.credits.length, 0);
  assert.match(partialCvuLink.link.checkoutUrl, /\/pay\//);
  const publicCheckout = await fetch(new URL(`/pay/${partialCvuLink.link.id}`, target), { redirect: 'manual' });
  assert.equal(publicCheckout.status, 200);
  const publicHtml = await publicCheckout.text();
  assert.match(publicHtml, /CVU sandbox/);
  assert.match(publicHtml, /Honorarios/);
  assert.match(publicHtml, /no es un checkout de tarjeta/i);
  assert.equal(publicCheckout.headers.get('set-cookie'), null);
  const amountOnQr = await json(await request(`/api/v1/payment-links/${syncLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-amount-qr-${runId}` },
    body: JSON.stringify({ method: 'cimbra_qr', payerAccountId: account.id, amount: '1.00' }),
  }), 400);
  assert.equal(amountOnQr.error.code, 'invalid_payment_link_pay');
  const firstPartial = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-a-${runId}` },
    body: JSON.stringify({ method: 'cimbra_cvu', payerAccountId: account.id, amount: '3.00' }),
  }), 201);
  assert.equal(firstPartial.link.status, 'open');
  assert.equal(firstPartial.link.collectedAmount, 3); assert.equal(firstPartial.link.remainingAmount, 5);
  assert.equal(firstPartial.link.partiallyCollected, true);
  assert.equal(firstPartial.link.credits.length, 1);
  assert.equal(firstPartial.link.credits[0].amount, 3);
  const checkoutAfterPartial = await fetch(new URL(`/pay/${partialCvuLink.link.id}`, target), { redirect: 'manual' });
  assert.equal(checkoutAfterPartial.status, 200);
  assert.match(await checkoutAfterPartial.text(), /Créditos al CVU/);
  const replayPartial = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-a-${runId}` },
    body: JSON.stringify({ method: 'cimbra_cvu', payerAccountId: account.id, amount: '3.00' }),
  }), 200);
  assert.equal(replayPartial.replayed, true); assert.equal(replayPartial.link.collectedAmount, 3);
  const secondPartial = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-b-${runId}` },
    body: JSON.stringify({ method: 'cimbra_cvu', payerAccountId: account.id, amount: '5.00' }),
  }), 201);
  assert.equal(secondPartial.link.status, 'paid');
  assert.equal(secondPartial.link.paidMethod, 'cimbra_cvu');
  assert.equal(secondPartial.link.collectedAmount, 8); assert.equal(secondPartial.link.remainingAmount, 0);
  assert.equal(secondPartial.link.partiallyCollected, false);
  assert.equal(secondPartial.link.credits.length, 2);
  const partialRefund = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/refund`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-refund-a-${runId}` },
    body: JSON.stringify({ amount: '3.00' }),
  }), 201);
  assert.equal(partialRefund.link.status, 'open');
  assert.equal(partialRefund.link.collectedAmount, 5); assert.equal(partialRefund.link.remainingAmount, 3);
  assert.equal(partialRefund.link.refundedAmount, 3);
  assert.equal(partialRefund.link.partiallyRefunded, true);
  assert.equal(partialRefund.link.refunds.length, 1);
  const refundReplay = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/refund`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-link-cvu-part-refund-a-${runId}` },
    body: JSON.stringify({ amount: '3.00' }),
  }), 200);
  assert.equal(refundReplay.replayed, true); assert.equal(refundReplay.link.refundedAmount, 3);
  const refundedPartial = await json(await request(`/api/v1/payment-links/${partialCvuLink.link.id}/refund`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-link-cvu-part-refund-${runId}` },
  }), 201);
  assert.equal(refundedPartial.link.status, 'refunded');
  assert.equal(refundedPartial.link.collectedAmount, 0);
  assert.equal(refundedPartial.link.refundedAmount, 8);
  assert.equal(refundedPartial.link.refunds.length, 2);

  const beneficiaryCuit = '30000075678';
  const echeqPayload = {
    drawerAccountId: account.id, externalReference: `CHQ-${runId}`, description: 'Alquiler QA',
    amount: '20.00', currency: 'ARS', beneficiaryName: 'QA Company', beneficiaryTaxId: beneficiaryCuit, toOrder: true,
  };
  const echeqIssued = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-${runId}` },
    body: JSON.stringify(echeqPayload),
  }), 201);
  assert.equal(echeqIssued.echeq.status, 'issued'); assert.match(echeqIssued.echeq.payload, /^cimbra:echeq:v1:/);
  assert.equal(echeqIssued.echeq.rail, 'cimbra_sandbox'); assert.equal(echeqIssued.echeq.beneficiaryTaxLast4, '5678');
  const echeqReplay = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-${runId}` },
    body: JSON.stringify(echeqPayload),
  }), 200);
  assert.equal(echeqReplay.replayed, true);
  const discountDenied = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-discount-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-DISC-${runId}`, discount: true }),
  }), 422);
  assert.equal(discountDenied.error.code, 'echeq_discount_not_supported');
  const accepted = await json(await request(`/api/v1/echeqs/${echeqIssued.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  assert.equal(accepted.echeq.status, 'accepted');
  const acceptedReplay = await json(await request(`/api/v1/echeqs/${echeqIssued.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 200);
  assert.equal(acceptedReplay.replayed, true);
  const chamberDenied = await json(await request(`/api/v1/echeqs/${echeqIssued.echeq.id}/deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-cbu-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit, destinationKind: 'cbu' }),
  }), 422);
  assert.equal(chamberDenied.error.code, 'coelsa_clearing_not_supported');
  const deposited = await json(await request(`/api/v1/echeqs/${echeqIssued.echeq.id}/deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-deposit-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  assert.equal(deposited.echeq.status, 'deposited');
  const depositedReplay = await json(await request(`/api/v1/echeqs/${echeqIssued.echeq.id}/deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-deposit-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 200);
  assert.equal(depositedReplay.replayed, true);
  const genericEcheqReverseDenied = await json(await request(`/api/v1/transfers/${deposited.echeq.transactionId}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-echeq-generic-reverse-${runId}` },
  }), 409);
  assert.equal(genericEcheqReverseDenied.error.code, 'echeq_deposit_irreversible');
  const cancelledIssue = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-cancel-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-CAN-${runId}` }),
  }), 201);
  const cancelledEcheq = await json(await request(`/api/v1/echeqs/${cancelledIssue.echeq.id}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-echeq-cancel-run-${runId}` },
  }), 201);
  assert.equal(cancelledEcheq.echeq.status, 'cancelled');
  const returnedIssue = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-return-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-RET-${runId}` }),
  }), 201);
  await json(await request(`/api/v1/echeqs/${returnedIssue.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-return-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  const returnedEcheq = await json(await request(`/api/v1/echeqs/${returnedIssue.echeq.id}/return`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-echeq-return-run-${runId}` },
  }), 201);
  assert.equal(returnedEcheq.echeq.status, 'returned');
  const noOrder = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-noorder-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-NO-${runId}`, toOrder: false }),
  }), 201);
  await json(await request(`/api/v1/echeqs/${noOrder.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-noorder-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  const endorseDenied = await json(await request(`/api/v1/echeqs/${noOrder.echeq.id}/endorse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-endorse-${runId}` },
    body: JSON.stringify({ beneficiaryName: 'Otro Beneficiario', beneficiaryTaxId: '20123456786' }),
  }), 422);
  assert.equal(endorseDenied.error.code, 'echeq_not_to_order');
  const addDays = (iso, days) => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  };
  const todayAr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const deferred = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-deferred-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-DEF-${runId}`, paymentDate: addDays(todayAr, 10) }),
  }), 201);
  await json(await request(`/api/v1/echeqs/${deferred.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-deferred-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  const notDue = await json(await request(`/api/v1/echeqs/${deferred.echeq.id}/deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-deferred-deposit-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 422);
  assert.equal(notDue.error.code, 'echeq_not_due');
  const nsf = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-nsf-${runId}` },
    body: JSON.stringify({ ...echeqPayload, externalReference: `CHQ-NSF-${runId}`, amount: '9999999.00' }),
  }), 201);
  await json(await request(`/api/v1/echeqs/${nsf.echeq.id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-nsf-accept-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  const rejected = await json(await request(`/api/v1/echeqs/${nsf.echeq.id}/deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-echeq-nsf-deposit-${runId}` },
    body: JSON.stringify({ accountId: destinationAccount.id, taxId: beneficiaryCuit }),
  }), 201);
  assert.equal(rejected.echeq.status, 'rejected'); assert.equal(rejected.echeq.rejectReason, 'insufficient_funds');
  assert.ok((await json(await request('/api/v1/echeqs?limit=10'), 200)).data.some((item) => item.id === echeqIssued.echeq.id));

  const servicesKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA native services', scopes: ['billers:read', 'billers:write', 'payments:read', 'payments:write', 'payouts:read', 'payouts:write'], expiresInDays: 1 }),
  }), 201);

  const payoutDestination = `qa.payout.${runId}`;
  const payoutBeneficiaryKey = `qa-payout-beneficiary-${runId}`;
  const payoutBeneficiaryPayload = { externalReference: `BEN-${runId}`, name: 'QA Proveedor Regional', entityType: 'business',
    country: 'AR', currency: 'ARS', destinationType: 'alias', destination: payoutDestination, bankCode: 'QA01' };
  const payoutBeneficiaryCreated = await json(await fetch(new URL('/api/v1/payout-beneficiaries', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBeneficiaryKey },
    body: JSON.stringify(payoutBeneficiaryPayload),
  }), 201);
  const payoutBeneficiary = payoutBeneficiaryCreated.beneficiary;
  assert.equal(payoutBeneficiary.status, 'active'); assert.equal(payoutBeneficiary.destinationLast4.length, 4);
  assert.equal(JSON.stringify(payoutBeneficiaryCreated).includes(payoutDestination), false);
  const payoutBeneficiaryReplay = await json(await fetch(new URL('/api/v1/payout-beneficiaries', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBeneficiaryKey },
    body: JSON.stringify(payoutBeneficiaryPayload),
  }), 200);
  assert.equal(payoutBeneficiaryReplay.replayed, true); assert.equal(payoutBeneficiaryReplay.beneficiary.id, payoutBeneficiary.id);
  const payoutBeneficiaryMismatch = await json(await fetch(new URL('/api/v1/payout-beneficiaries', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBeneficiaryKey },
    body: JSON.stringify({ ...payoutBeneficiaryPayload, name: 'QA Otro proveedor' }),
  }), 409);
  assert.equal(payoutBeneficiaryMismatch.error.code, 'idempotency_mismatch');
  assert.ok((await json(await fetch(new URL('/api/v1/payout-beneficiaries', target), {
    headers: { Authorization: `Bearer ${servicesKey.secret}` },
  }), 200)).data.some((item) => item.id === payoutBeneficiary.id));

  const payoutBatchKey = `qa-payout-batch-${runId}`;
  const payoutBatchPayload = { sourceAccountId: account.id, externalReference: `PAY-${runId}`, description: 'Nómina de proveedores QA', currency: 'ARS',
    items: [{ externalReference: `PAY-ITEM-${runId}`, beneficiaryId: payoutBeneficiary.id, amount: '25.00', description: 'Factura QA 001' }] };
  const payoutBatchCreated = await json(await fetch(new URL('/api/v1/payout-batches', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBatchKey },
    body: JSON.stringify(payoutBatchPayload),
  }), 201);
  const payoutBatch = payoutBatchCreated.batch;
  assert.equal(payoutBatch.status, 'draft'); assert.equal(payoutBatch.itemCount, 1); assert.equal(payoutBatch.totalAmountMinor, '2500');
  const payoutBatchReplay = await json(await fetch(new URL('/api/v1/payout-batches', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBatchKey },
    body: JSON.stringify(payoutBatchPayload),
  }), 200);
  assert.equal(payoutBatchReplay.replayed, true); assert.equal(payoutBatchReplay.batch.id, payoutBatch.id);
  const payoutBatchMismatch = await json(await fetch(new URL('/api/v1/payout-batches', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': payoutBatchKey },
    body: JSON.stringify({ ...payoutBatchPayload, description: 'Contenido distinto' }),
  }), 409);
  assert.equal(payoutBatchMismatch.error.code, 'idempotency_mismatch');
  const payoutSubmitted = await json(await fetch(new URL(`/api/v1/payout-batches/${payoutBatch.id}/submit`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-submit-${runId}` },
    body: '{}',
  }), 202);
  assert.equal(payoutSubmitted.requiresApproval, false);
  const completedPayout = await waitForPayoutBatch(payoutBatch.id, ['completed']);
  assert.equal(completedPayout.items[0].status, 'settled'); assert.ok(completedPayout.items[0].transactionId);
  const payoutResult = await fetch(new URL(`/api/v1/payout-batches/${payoutBatch.id}/result`, target), {
    headers: { Authorization: `Bearer ${servicesKey.secret}` },
  });
  assert.equal(payoutResult.status, 200); assert.match(payoutResult.headers.get('content-type') ?? '', /^text\/csv/);
  const payoutCsv = await payoutResult.text(); assert.match(payoutCsv, new RegExp(`PAY-ITEM-${runId}`)); assert.match(payoutCsv, /settled/);
  assert.equal(payoutCsv.includes(payoutDestination), false);
  await json(await request(`/api/v1/transfers/${completedPayout.items[0].transactionId}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-payout-reverse-${runId}` },
  }), 201);
  const compensatedPayout = await json(await request(`/api/v1/payout-batches/${payoutBatch.id}`), 200);
  assert.equal(compensatedPayout.status, 'failed'); assert.equal(compensatedPayout.items[0].failureCode, 'payout_reversed');

  const scheduledPayoutPayload = { ...payoutBatchPayload, externalReference: `PAY-SCHEDULED-${runId}`, description: 'Payout programado QA',
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    items: [{ ...payoutBatchPayload.items[0], externalReference: `PAY-SCHEDULED-ITEM-${runId}` }] };
  const scheduledPayout = (await json(await request('/api/v1/payout-batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-scheduled-${runId}` }, body: JSON.stringify(scheduledPayoutPayload),
  }), 201)).batch;
  const scheduledPayoutSubmit = await json(await request(`/api/v1/payout-batches/${scheduledPayout.id}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-scheduled-submit-${runId}` }, body: '{}',
  }), 202);
  assert.equal(scheduledPayoutSubmit.batch.status, 'scheduled');
  const cancelledPayout = await json(await request(`/api/v1/payout-batches/${scheduledPayout.id}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-payout-cancel-${runId}` },
  }), 200);
  assert.equal(cancelledPayout.batch.status, 'cancelled'); assert.equal(cancelledPayout.batch.items[0].status, 'cancelled');

  const payoutPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'payout_batch.execute', enabled: true, expiresInMinutes: 60 }),
  }), 200);
  assert.equal(payoutPolicy.policy.enabled, true);
  const approvedPayoutPayload = { ...payoutBatchPayload, externalReference: `PAY-APPROVAL-${runId}`, description: 'Payout con doble control QA',
    items: [{ ...payoutBatchPayload.items[0], externalReference: `PAY-APPROVAL-ITEM-${runId}`, amount: '15.00' }] };
  const approvedPayout = (await json(await request('/api/v1/payout-batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-approval-${runId}` }, body: JSON.stringify(approvedPayoutPayload),
  }), 201)).batch;
  const payoutApprovalRequired = await json(await request(`/api/v1/payout-batches/${approvedPayout.id}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-approval-submit-${runId}` }, body: '{}',
  }), 202);
  assert.equal(payoutApprovalRequired.requiresApproval, true); assert.equal(payoutApprovalRequired.approval.actionType, 'payout_batch.execute');
  const payoutSelfApproval = await json(await request(`/api/v1/approvals/${payoutApprovalRequired.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-self-${runId}` },
    body: JSON.stringify({ reason: 'El maker no puede aprobar su propio lote.' }),
  }), 409);
  assert.equal(payoutSelfApproval.error.code, 'approval_self_decision');
  cookie = checkerCookie;
  const payoutApproved = await json(await request(`/api/v1/approvals/${payoutApprovalRequired.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-checker-${runId}` },
    body: JSON.stringify({ reason: 'QA checker autoriza el lote verificado.' }),
  }), 200);
  assert.equal(payoutApproved.approval.status, 'executed'); assert.ok(['processing', 'scheduled'].includes(payoutApproved.payoutBatch.status));
  cookie = ownerCookie;
  const completedApprovedPayout = await waitForPayoutBatch(approvedPayout.id, ['completed']);
  assert.equal(completedApprovedPayout.items[0].status, 'settled');

  const suspendedPayoutBeneficiary = await json(await request(`/api/v1/payout-beneficiaries/${payoutBeneficiary.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-beneficiary-suspend-${runId}` }, body: JSON.stringify({ action: 'suspend' }),
  }), 200);
  assert.equal(suspendedPayoutBeneficiary.beneficiary.status, 'suspended');
  const suspendedBeneficiaryBatch = await json(await request('/api/v1/payout-batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-suspended-${runId}` },
    body: JSON.stringify({ ...payoutBatchPayload, externalReference: `PAY-SUSPENDED-${runId}`,
      items: [{ ...payoutBatchPayload.items[0], externalReference: `PAY-SUSPENDED-ITEM-${runId}` }] }),
  }), 409);
  assert.equal(suspendedBeneficiaryBatch.error.code, 'payout_beneficiary_suspended');
  await json(await request(`/api/v1/payout-beneficiaries/${payoutBeneficiary.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-payout-beneficiary-activate-${runId}` }, body: JSON.stringify({ action: 'activate' }),
  }), 200);

  const billerKey = `qa-biller-${runId}`;
  const billerPayload = { code: `QA_ENERGY_${runId.slice(0, 8)}`, name: 'QA Energía Regional', country: 'AR', category: 'utilities',
    serviceType: 'bill_payment', currency: 'ARS', amountMode: 'exact', contractReference: `DIRECT-${runId.slice(0, 8)}` };
  const billerCreated = await json(await fetch(new URL('/api/v1/billers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': billerKey },
    body: JSON.stringify(billerPayload),
  }), 201);
  const biller = billerCreated.biller;
  assert.equal(biller.serviceType, 'bill_payment'); assert.equal(biller.status, 'active');
  const billerReplay = await json(await fetch(new URL('/api/v1/billers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': billerKey },
    body: JSON.stringify(billerPayload),
  }), 200);
  assert.equal(billerReplay.replayed, true); assert.equal(billerReplay.biller.id, biller.id);
  const billerMismatch = await json(await fetch(new URL('/api/v1/billers', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': billerKey },
    body: JSON.stringify({ ...billerPayload, name: 'Otro nombre' }),
  }), 409);
  assert.equal(billerMismatch.error.code, 'idempotency_mismatch');
  assert.equal((await json(await request(`/api/v1/billers/${biller.id}`), 200)).data.code, billerPayload.code.toUpperCase());
  assert.ok((await json(await fetch(new URL('/api/v1/billers', target), { headers: { Authorization: `Bearer ${servicesKey.secret}` } }), 200)).data.some((item) => item.id === biller.id));
  const suspendedBiller = await json(await request(`/api/v1/billers/${biller.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-biller-suspend-${runId}` }, body: JSON.stringify({ action: 'suspend' }),
  }), 200);
  assert.equal(suspendedBiller.biller.status, 'suspended');
  const billerLifecycleMismatch = await json(await request(`/api/v1/billers/${biller.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-biller-suspend-${runId}` }, body: JSON.stringify({ action: 'activate' }),
  }), 409);
  assert.equal(billerLifecycleMismatch.error.code, 'idempotency_mismatch');
  await json(await request(`/api/v1/billers/${biller.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-biller-activate-${runId}` }, body: JSON.stringify({ action: 'activate' }),
  }), 200);

  const obligationKey = `qa-obligation-${runId}`;
  const subscriberReference = `CLIENTE-${runId.slice(0, 12)}`;
  const obligationPayload = { externalReference: `INV-${runId.slice(0, 12)}`, subscriberReference, amount: '18.25',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(), description: 'Servicio energético QA' };
  const obligationCreated = await json(await fetch(new URL(`/api/v1/billers/${biller.id}/obligations`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': obligationKey },
    body: JSON.stringify(obligationPayload),
  }), 201);
  const obligation = obligationCreated.obligation;
  assert.equal(obligation.amountMinor, '1825'); assert.equal(obligation.status, 'open');
  assert.equal(JSON.stringify(obligation).includes(subscriberReference), false); assert.equal(obligation.subscriberReferenceLast4.length, 4);
  const obligationReplay = await json(await fetch(new URL(`/api/v1/billers/${biller.id}/obligations`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': obligationKey },
    body: JSON.stringify(obligationPayload),
  }), 200);
  assert.equal(obligationReplay.replayed, true); assert.equal(obligationReplay.obligation.id, obligation.id);
  const debtQuery = (await json(await request(`/api/v1/billers/${biller.id}/obligations?subscriberReference=${encodeURIComponent(subscriberReference)}`), 200)).data;
  assert.equal(debtQuery.length, 1); assert.equal(JSON.stringify(debtQuery).includes(subscriberReference), false);

  const orderKey = `qa-bill-payment-${runId}`;
  const billPaymentCreated = await json(await fetch(new URL('/api/v1/bill-payments', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': orderKey },
    body: JSON.stringify({ accountId: account.id, billerId: biller.id, obligationId: obligation.id }),
  }), 201);
  const billPayment = billPaymentCreated.order;
  assert.equal(billPayment.status, 'settled'); assert.ok(billPayment.transactionId);
  const paymentReplay = await json(await fetch(new URL('/api/v1/bill-payments', target), {
    method: 'POST', headers: { Authorization: `Bearer ${servicesKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': orderKey },
    body: JSON.stringify({ accountId: account.id, billerId: biller.id, obligationId: obligation.id }),
  }), 200);
  assert.equal(paymentReplay.replayed, true); assert.equal(paymentReplay.order.id, billPayment.id);
  assert.equal((await json(await request(`/api/v1/bill-payments/${billPayment.id}`), 200)).data.status, 'settled');
  const genericBillReverseDenied = await json(await request(`/api/v1/transfers/${billPayment.transactionId}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-invalid-bill-reverse-${runId}` },
  }), 409);
  assert.equal(genericBillReverseDenied.error.code, 'bill_payment_reverse_required');
  const reversedBill = await json(await request(`/api/v1/bill-payments/${billPayment.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-bill-reverse-${runId}` },
  }), 200);
  assert.equal(reversedBill.order.status, 'reversed'); assert.ok(reversedBill.order.reversalTransactionId);
  const reversedBillReplay = await json(await request(`/api/v1/bill-payments/${billPayment.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-bill-reverse-${runId}` },
  }), 200);
  assert.equal(reversedBillReplay.replayed, true);
  assert.equal((await json(await request(`/api/v1/billers/${biller.id}/obligations`), 200)).data.find((item) => item.id === obligation.id).status, 'open');

  const topup = (await json(await request('/api/v1/billers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-topup-biller-${runId}` },
    body: JSON.stringify({ code: `QA_TOPUP_${runId.slice(0, 8)}`, name: 'QA Recargas', country: 'AR', category: 'telecom',
      serviceType: 'mobile_topup', currency: 'ARS', amountMode: 'range', minAmount: '1.00', maxAmount: '100.00' }),
  }), 201)).biller;
  const topupOrder = (await json(await request('/api/v1/bill-payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-topup-order-${runId}` },
    body: JSON.stringify({ accountId: account.id, billerId: topup.id, destinationReference: '5491100001234', amount: '5.00' }),
  }), 201)).order;
  assert.equal(topupOrder.status, 'settled'); assert.equal(topupOrder.amountMinor, '500'); assert.equal(topupOrder.destinationReferenceLast4, '1234');
  await json(await request(`/api/v1/bill-payments/${topupOrder.id}/reverse`, { method: 'POST', headers: { 'Idempotency-Key': `qa-topup-reverse-${runId}` } }), 200);
  const giftCard = (await json(await request('/api/v1/billers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-gift-biller-${runId}` },
    body: JSON.stringify({ code: `QA_GIFT_${runId.slice(0, 8)}`, name: 'QA Gift Card', country: 'AR', category: 'entertainment',
      serviceType: 'gift_card', currency: 'ARS', amountMode: 'fixed', minAmount: '20.00', maxAmount: '20.00' }),
  }), 201)).biller;
  assert.equal(giftCard.amountMode, 'fixed'); assert.equal(giftCard.minAmountMinor, '2000');

  const consentReference = `CONSENT-${runId}`;
  const mandatePayload = { accountId: account.id, billerId: topup.id, subscriberReference: '5491100001234', frequency: 'monthly', amount: '5.00',
    amountLimit: '10.00', consentReference, consentedAt: new Date().toISOString(), nextChargeAt: new Date(Date.now() + 86_400_000).toISOString(), maxRetries: 3 };
  const mandateCreated = await json(await request('/api/v1/recurring-mandates', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-${runId}` }, body: JSON.stringify(mandatePayload),
  }), 201);
  const mandate = mandateCreated.mandate;
  assert.equal(mandate.status, 'active'); assert.equal(mandate.subscriberReferenceLast4, '1234'); assert.equal(JSON.stringify(mandate).includes('5491100001234'), false);
  const duplicateConsent = await json(await request('/api/v1/recurring-mandates', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-duplicate-${runId}` }, body: JSON.stringify(mandatePayload),
  }), 409);
  assert.equal(duplicateConsent.error.code, 'mandate_consent_exists');
  const pausedMandate = await json(await request(`/api/v1/recurring-mandates/${mandate.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-pause-${runId}` }, body: JSON.stringify({ action: 'pause' }),
  }), 200);
  assert.equal(pausedMandate.mandate.status, 'paused');
  const mandateLifecycleMismatch = await json(await request(`/api/v1/recurring-mandates/${mandate.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-pause-${runId}` }, body: JSON.stringify({ action: 'resume' }),
  }), 409);
  assert.equal(mandateLifecycleMismatch.error.code, 'idempotency_mismatch');
  await json(await request(`/api/v1/recurring-mandates/${mandate.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-resume-${runId}` }, body: JSON.stringify({ action: 'resume' }),
  }), 200);
  const cancelledMandate = await json(await request(`/api/v1/recurring-mandates/${mandate.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-mandate-cancel-${runId}` }, body: JSON.stringify({ action: 'cancel' }),
  }), 200);
  assert.equal(cancelledMandate.mandate.status, 'cancelled');
  assert.equal((await json(await request(`/api/v1/recurring-mandates/${mandate.id}`), 200)).data.status, 'cancelled');
  assert.ok((await json(await fetch(new URL('/api/v1/recurring-mandates', target), { headers: { Authorization: `Bearer ${servicesKey.secret}` } }), 200)).data.some((item) => item.id === mandate.id));

  const programKey = `qa-card-program-${runId}`;
  const programPayload = { name: `QA Physical ARS ${runId.slice(0, 8)}`, product: 'debit', formats: ['virtual', 'physical'], defaultCurrency: 'ARS' };
  const program = await json(await request('/api/v1/card-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': programKey }, body: JSON.stringify(programPayload),
  }), 201);
  assert.equal(program.program.product, 'debit');
  const programReplay = await json(await request('/api/v1/card-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': programKey }, body: JSON.stringify(programPayload),
  }), 200);
  assert.equal(programReplay.replayed, true); assert.equal(programReplay.program.id, program.program.id);
  const retrievedProgram = await json(await request(`/api/v1/card-programs/${program.program.id}`), 200);
  assert.equal(retrievedProgram.name, programPayload.name);
  assert.ok((await json(await request('/api/v1/card-programs'), 200)).data.some((item) => item.id === program.program.id));

  const cardKey = `qa-card-${runId}`;
  const cardPayload = { accountId: account.id, programId: program.program.id, format: 'physical' };
  const card = (await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 201)).card;
  assert.equal(card.status, 'created'); assert.equal(card.programId, program.program.id); assert.equal(card.programName, programPayload.name);
  assert.equal('pan' in card, false); assert.equal('cvv' in card, false); assert.equal('networkToken' in card, false);
  const cardReplay = await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 200);
  assert.equal(cardReplay.card.id, card.id);
  const initialLifecycle = (await json(await request(`/api/v1/cards/${card.id}/lifecycle`), 200)).data;
  assert.equal(initialLifecycle.length, 1); assert.equal(initialLifecycle[0].toStatus, 'created'); assert.equal(initialLifecycle[0].reason, 'issued');
  const initialControls = (await json(await request(`/api/v1/cards/${card.id}/controls`), 200)).controls;
  assert.equal(initialControls.version, 1); assert.deepEqual(initialControls.allowedChannels.sort(), ['atm', 'chip', 'contactless', 'ecommerce', 'magstripe']);
  const controlsKey = `qa-card-controls-${runId}`;
  const controlsPayload = { currency: 'ARS', perTransactionLimit: '2500.50', dailyLimit: '5000.00', monthlyLimit: '30000.00',
    allowedChannels: ['chip', 'contactless', 'ecommerce'], allowedMccs: [], blockedMccs: ['7995'], status: 'active' };
  const updatedControls = await json(await request(`/api/v1/cards/${card.id}/controls`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': controlsKey }, body: JSON.stringify(controlsPayload),
  }), 200);
  assert.equal(updatedControls.controls.version, 2); assert.equal(updatedControls.controls.perTransactionLimitMinor, '250050');
  const controlsReplay = await json(await request(`/api/v1/cards/${card.id}/controls`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': controlsKey }, body: JSON.stringify(controlsPayload),
  }), 200);
  assert.equal(controlsReplay.replayed, true); assert.equal(controlsReplay.controls.id, updatedControls.controls.id);
  await json(await request(`/api/v1/cards/${card.id}/controls`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': controlsKey },
    body: JSON.stringify({ ...controlsPayload, dailyLimit: '6000.00' }),
  }), 409);

  const cardTransition = async (suffix, status, reason) => json(await request(`/api/v1/cards/${card.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-card-${suffix}-${runId}` },
    body: JSON.stringify({ status, reason }),
  }), 200);
  const activated = await cardTransition('activate', 'active', 'activation');
  assert.equal(activated.event.fromStatus, 'created'); assert.equal(activated.event.toStatus, 'active');
  const activationReplay = await json(await request(`/api/v1/cards/${card.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-card-activate-${runId}` },
    body: JSON.stringify({ status: 'active', reason: 'activation' }),
  }), 200);
  assert.equal(activationReplay.replayed, true); assert.equal('requestFingerprint' in activationReplay.event, false);
  await cardTransition('freeze', 'frozen', 'suspected_fraud');
  await cardTransition('unfreeze', 'active', 'review_cleared');
  await cardTransition('terminate', 'terminated', 'customer_request');
  const invalidReactivation = await json(await request(`/api/v1/cards/${card.id}/lifecycle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-card-invalid-${runId}` },
    body: JSON.stringify({ status: 'active', reason: 'review_cleared' }),
  }), 409);
  assert.equal(invalidReactivation.error.code, 'invalid_card_transition');
  const controlsAfterTermination = await json(await request(`/api/v1/cards/${card.id}/controls`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-card-controls-terminated-${runId}` },
    body: JSON.stringify(controlsPayload),
  }), 409);
  assert.equal(controlsAfterTermination.error.code, 'card_terminated');
  const finalCard = await json(await request(`/api/v1/cards/${card.id}`), 200);
  assert.equal(finalCard.status, 'terminated'); assert.equal(finalCard.statusReason, 'customer_request');
  const finalLifecycle = (await json(await request(`/api/v1/cards/${card.id}/lifecycle`), 200)).data;
  assert.equal(finalLifecycle.length, 5); assert.equal(finalLifecycle[0].toStatus, 'terminated');
  const cardAuditEvents = (await json(await request('/api/v1/events'), 200)).data;
  assert.ok(cardAuditEvents.some((event) => event.action === 'card.program_created'));
  assert.ok(cardAuditEvents.some((event) => event.action === 'card.controls_updated'));
  assert.ok(cardAuditEvents.some((event) => event.action === 'card.terminated'));

  const championPayload = { name: 'QA policy family', kind: 'counterparty_match', operationType: 'transfer', scoreDelta: 0,
    action: 'decline', priority: 50, configuration: { pattern: 'qa policy baseline never matches' } };
  const championKey = `qa-risk-champion-${runId}`;
  const champion = await json(await request('/api/v1/risk/rules', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': championKey }, body: JSON.stringify(championPayload),
  }), 201);
  assert.equal(champion.rule.version, 1); assert.equal(champion.rule.deployment, 'champion');
  const championReplay = await json(await request('/api/v1/risk/rules', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': championKey }, body: JSON.stringify(championPayload),
  }), 200);
  assert.equal(championReplay.replayed, true); assert.equal(championReplay.rule.id, champion.rule.id);
  const challengerPayload = { ...championPayload, name: 'QA policy candidate', scoreDelta: 70,
    configuration: { pattern: 'qa policy target' } };
  const challengerKey = `qa-risk-challenger-${runId}`;
  const challenger = await json(await request(`/api/v1/risk/rules/${champion.rule.id}/versions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': challengerKey }, body: JSON.stringify(challengerPayload),
  }), 201);
  assert.equal(challenger.rule.familyId, champion.rule.familyId); assert.equal(challenger.rule.version, 2);
  assert.equal(challenger.rule.deployment, 'challenger');
  const shadowBefore = await json(await request('/api/v1/risk/evaluations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-shadow-before-${runId}` },
    body: JSON.stringify({ operationType: 'transfer', amount: '100.00', currency: 'ARS', counterparty: 'QA Policy Target' }),
  }), 201);
  assert.equal(shadowBefore.evaluation.decision, 'approve');
  assert.equal(shadowBefore.evaluation.matchedRuleIds.includes(challenger.rule.id), false);
  const simulationPayload = { candidateRuleId: challenger.rule.id, samples: [
    { operationType: 'transfer', amount: '100.00', currency: 'ARS', counterparty: 'QA Policy Target' },
    { operationType: 'cash_in', amount: '50.00', currency: 'ARS', counterparty: 'QA Policy Target' },
  ] };
  const simulationKey = `qa-risk-simulation-${runId}`;
  const simulation = await json(await request('/api/v1/risk/simulations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': simulationKey }, body: JSON.stringify(simulationPayload),
  }), 201);
  assert.equal(simulation.simulation.sampleCount, 2); assert.equal(simulation.simulation.deltaSummary.decisionsChanged, 1);
  assert.equal(simulation.simulation.candidateSummary.decline, 1);
  const simulationReplay = await json(await request('/api/v1/risk/simulations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': simulationKey }, body: JSON.stringify(simulationPayload),
  }), 200);
  assert.equal(simulationReplay.replayed, true); assert.equal(simulationReplay.simulation.id, simulation.simulation.id);
  const promotionKey = `qa-risk-promotion-${runId}`;
  const promotion = await json(await request(`/api/v1/risk/rules/${challenger.rule.id}/promote`, {
    method: 'POST', headers: { 'Idempotency-Key': promotionKey },
  }), 200);
  assert.equal(promotion.promotion.previousChampionId, champion.rule.id); assert.equal(promotion.promotion.version, 2);
  const promotionReplay = await json(await request(`/api/v1/risk/rules/${challenger.rule.id}/promote`, {
    method: 'POST', headers: { 'Idempotency-Key': promotionKey },
  }), 200);
  assert.equal(promotionReplay.replayed, true);
  const shadowAfter = await json(await request('/api/v1/risk/evaluations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-shadow-after-${runId}` },
    body: JSON.stringify({ operationType: 'transfer', amount: '100.00', currency: 'ARS', counterparty: 'QA Policy Target' }),
  }), 201);
  assert.equal(shadowAfter.evaluation.decision, 'decline'); assert.equal(shadowAfter.evaluation.matchedRuleIds.includes(challenger.rule.id), true);
  const versionedRiskState = (await json(await request('/api/v1/risk'), 200)).data;
  assert.equal(versionedRiskState.rules.find((rule) => rule.id === champion.rule.id).deployment, 'archived');
  assert.equal(versionedRiskState.rules.find((rule) => rule.id === challenger.rule.id).deployment, 'champion');
  assert.equal(versionedRiskState.simulations.some((item) => item.id === simulation.simulation.id), true);
  assert.equal(JSON.stringify(versionedRiskState.simulations).toLowerCase().includes('qa policy target'), false);
  assert.equal(versionedRiskState.metrics.totalEvaluations >= 2, true);

  const deviceReference = `qa-device-secret-${runId}`;
  const identityReference = `qa-identity-secret-${runId}`;
  const blockListPayload = { subjectType: 'device', subjectValue: deviceReference, category: 'block', reason: 'QA confirmed device block' };
  const blockListKey = `qa-risk-list-block-${runId}`;
  const blockList = await json(await request('/api/v1/risk/lists', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': blockListKey }, body: JSON.stringify(blockListPayload),
  }), 201);
  assert.equal(blockList.entry.category, 'block'); assert.equal(blockList.entry.subjectType, 'device');
  assert.equal(JSON.stringify(blockList).includes(deviceReference), false);
  const blockListReplay = await json(await request('/api/v1/risk/lists', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': blockListKey }, body: JSON.stringify(blockListPayload),
  }), 200);
  assert.equal(blockListReplay.replayed, true); assert.equal(blockListReplay.entry.id, blockList.entry.id);
  const blockListMismatch = await json(await request('/api/v1/risk/lists', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': blockListKey },
    body: JSON.stringify({ ...blockListPayload, category: 'watch' }),
  }), 409);
  assert.equal(blockListMismatch.error.code, 'idempotency_mismatch');
  const blockedEvaluation = await json(await request('/api/v1/risk/evaluations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-device-blocked-${runId}` },
    body: JSON.stringify({ operationType: 'transfer', amount: '125.00', currency: 'ARS', counterparty: 'QA Device Subject',
      signals: { deviceReference, identityReference, deviceTrust: 'trusted', identityVerified: true, ipCountry: 'AR', countryMismatch: false } }),
  }), 201);
  assert.equal(blockedEvaluation.evaluation.decision, 'decline');
  assert.equal(blockedEvaluation.evaluation.matchedListEntryIds.includes(blockList.entry.id), true);
  assert.equal(blockedEvaluation.evaluation.signals.deviceReferencePresent, true);
  assert.equal(blockedEvaluation.evaluation.signals.identityReferencePresent, true);
  assert.equal(blockedEvaluation.evaluation.signals.deviceTrust, 'trusted');
  assert.equal(JSON.stringify(blockedEvaluation).includes(deviceReference), false);
  assert.equal(JSON.stringify(blockedEvaluation).includes(identityReference), false);
  assert.equal(JSON.stringify(blockedEvaluation).includes('deviceHash'), false);
  const [storedSignals] = await sql`SELECT signals FROM risk_evaluations WHERE id = ${blockedEvaluation.evaluation.id}`;
  assert.equal(storedSignals.signals.includes(deviceReference), false); assert.equal(storedSignals.signals.includes(identityReference), false);
  assert.match(JSON.parse(storedSignals.signals).deviceHash, /^[A-Za-z0-9_-]{43}$/);

  const fraudOutcomePayload = { label: 'fraud', fraudType: 'account_takeover', lossAmount: '12.34', currency: 'ARS', note: 'QA issuer confirmation' };
  const fraudOutcomeKey = `qa-risk-outcome-fraud-${runId}`;
  const fraudOutcome = await json(await request(`/api/v1/risk/evaluations/${blockedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fraudOutcomeKey }, body: JSON.stringify(fraudOutcomePayload),
  }), 201);
  assert.equal(fraudOutcome.outcome.label, 'fraud'); assert.equal(fraudOutcome.outcome.lossAmountMinor, '1234');
  const fraudOutcomeReplay = await json(await request(`/api/v1/risk/evaluations/${blockedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fraudOutcomeKey }, body: JSON.stringify(fraudOutcomePayload),
  }), 200);
  assert.equal(fraudOutcomeReplay.replayed, true); assert.equal(fraudOutcomeReplay.outcome.id, fraudOutcome.outcome.id);
  const fraudOutcomeMismatch = await json(await request(`/api/v1/risk/evaluations/${blockedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fraudOutcomeKey }, body: JSON.stringify({ label: 'legitimate' }),
  }), 409);
  assert.equal(fraudOutcomeMismatch.error.code, 'idempotency_mismatch');

  const watchCounterparty = `QA Watch ${runId}`;
  const watchList = await json(await request('/api/v1/risk/lists', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-list-watch-${runId}` },
    body: JSON.stringify({ subjectType: 'counterparty', subjectValue: watchCounterparty, category: 'watch', reason: 'QA monitored counterparty' }),
  }), 201);
  const watchedEvaluation = await json(await request('/api/v1/risk/evaluations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-watch-evaluation-${runId}` },
    body: JSON.stringify({ operationType: 'cash_out', amount: '25.00', currency: 'ARS', counterparty: watchCounterparty }),
  }), 201);
  assert.equal(watchedEvaluation.evaluation.decision, 'review');
  assert.equal(watchedEvaluation.evaluation.matchedListEntryIds.includes(watchList.entry.id), true);
  assert.equal(Number.isInteger(watchedEvaluation.evaluation.decisionLatencyMs), true);
  assert.equal(watchedEvaluation.evaluation.decisionLatencyMs >= 0, true);
  const invalidStepUp = await json(await request(`/api/v1/risk/evaluations/${shadowBefore.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-step-up-invalid-${runId}` },
    body: JSON.stringify({ method: 'otp', delivery: 'client_managed' }),
  }), 409);
  assert.equal(invalidStepUp.error.code, 'risk_evaluation_not_review');
  const stepUpPayload = { method: 'otp', delivery: 'client_managed', expiresInSeconds: 300, maxAttempts: 5 };
  const stepUpKey = `qa-step-up-create-${runId}`;
  const stepUp = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stepUpKey }, body: JSON.stringify(stepUpPayload),
  }), 201);
  assert.match(stepUp.credential, /^\d{6}$/); assert.equal(stepUp.challenge.status, 'pending');
  const stepUpReplay = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stepUpKey }, body: JSON.stringify(stepUpPayload),
  }), 200);
  assert.equal(stepUpReplay.replayed, true); assert.equal(stepUpReplay.challenge.id, stepUp.challenge.id);
  assert.equal(stepUpReplay.credential, stepUp.credential);
  const stepUpMismatch = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': stepUpKey },
    body: JSON.stringify({ ...stepUpPayload, maxAttempts: 4 }),
  }), 409);
  assert.equal(stepUpMismatch.error.code, 'idempotency_mismatch');
  const listedStepUps = (await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`), 200)).data;
  assert.equal(listedStepUps.length, 1); assert.equal(JSON.stringify(listedStepUps).includes(stepUp.credential), false);
  assert.equal(Object.hasOwn(listedStepUps[0], 'credential'), false);
  const [storedStepUp] = await sql`SELECT credential_hash, credential_ciphertext FROM risk_step_up_challenges WHERE id = ${stepUp.challenge.id}`;
  assert.notEqual(storedStepUp.credential_hash, stepUp.credential); assert.notEqual(storedStepUp.credential_ciphertext, stepUp.credential);
  const wrongCredential = stepUp.credential === '000000' ? '000001' : '000000';
  const wrongAttemptKey = `qa-step-up-wrong-${runId}`;
  const wrongAttempt = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges/${stepUp.challenge.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': wrongAttemptKey },
    body: JSON.stringify({ credential: wrongCredential }),
  }), 200);
  assert.equal(wrongAttempt.verified, false); assert.equal(wrongAttempt.attempt.result, 'mismatch');
  assert.equal(wrongAttempt.challenge.remainingAttempts, 4);
  const wrongAttemptReplay = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges/${stepUp.challenge.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': wrongAttemptKey },
    body: JSON.stringify({ credential: wrongCredential }),
  }), 200);
  assert.equal(wrongAttemptReplay.replayed, true); assert.equal(wrongAttemptReplay.attempt.id, wrongAttempt.attempt.id);
  const wrongAttemptMismatch = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges/${stepUp.challenge.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': wrongAttemptKey },
    body: JSON.stringify({ credential: stepUp.credential }),
  }), 409);
  assert.equal(wrongAttemptMismatch.error.code, 'idempotency_mismatch');
  const verifiedStepUp = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges/${stepUp.challenge.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-step-up-correct-${runId}` },
    body: JSON.stringify({ credential: stepUp.credential }),
  }), 200);
  assert.equal(verifiedStepUp.verified, true); assert.equal(verifiedStepUp.challenge.status, 'verified');
  assert.equal(verifiedStepUp.attempt.attemptNumber, 2);
  const lockedStepUp = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges/${stepUp.challenge.id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-step-up-locked-${runId}` },
    body: JSON.stringify({ credential: stepUp.credential }),
  }), 200);
  assert.equal(lockedStepUp.verified, false); assert.equal(lockedStepUp.attempt.result, 'locked');
  const expiringStepUp = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-step-up-expiring-${runId}` },
    body: JSON.stringify(stepUpPayload),
  }), 201);
  await sql`UPDATE risk_step_up_challenges SET expires_at = ${new Date(Date.now() - 60_000).toISOString()} WHERE id = ${expiringStepUp.challenge.id}`;
  const afterExpiry = (await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`), 200)).data;
  assert.equal(afterExpiry.find((item) => item.id === expiringStepUp.challenge.id).status, 'expired');
  const [purgedStepUp] = await sql`SELECT credential_ciphertext FROM risk_step_up_challenges WHERE id = ${expiringStepUp.challenge.id}`;
  assert.equal(purgedStepUp.credential_ciphertext, null);
  await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-outcome-legitimate-${runId}` },
    body: JSON.stringify({ label: 'legitimate', note: 'QA customer confirmation' }),
  }), 201);
  const supervisedRiskState = (await json(await request('/api/v1/risk'), 200)).data;
  assert.equal(supervisedRiskState.stepUpChallenges.find((item) => item.id === stepUp.challenge.id).status, 'verified');
  assert.equal(supervisedRiskState.metrics.stepUp.verified >= 1, true);
  assert.equal(supervisedRiskState.metrics.decisionSlo.samples >= 1, true);
  assert.equal(supervisedRiskState.metrics.decisionSlo.p95Ms >= 0, true);
  assert.equal(supervisedRiskState.metrics.confirmed.total, 2);
  assert.equal(supervisedRiskState.metrics.confirmed.truePositives, 1);
  assert.equal(supervisedRiskState.metrics.confirmed.falsePositives, 1);
  assert.equal(supervisedRiskState.metrics.confirmed.precision, 50);
  assert.equal(supervisedRiskState.metrics.confirmed.recall, 100);
  assert.equal(supervisedRiskState.metrics.confirmed.losses.find((item) => item.currency === 'ARS').amountMinor, '1234');
  const correctedOutcome = await json(await request(`/api/v1/risk/evaluations/${blockedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-outcome-correction-${runId}` },
    body: JSON.stringify({ label: 'legitimate', note: 'QA correction after customer evidence', supersedesOutcomeId: fraudOutcome.outcome.id }),
  }), 201);
  assert.equal(correctedOutcome.outcome.supersedesOutcomeId, fraudOutcome.outcome.id);
  const correctedRiskState = (await json(await request('/api/v1/risk'), 200)).data;
  assert.equal(correctedRiskState.metrics.confirmed.total, 2);
  assert.equal(correctedRiskState.metrics.confirmed.truePositives, 0);
  assert.equal(correctedRiskState.metrics.confirmed.falsePositives, 2);
  assert.equal(correctedRiskState.evaluations.find((item) => item.id === blockedEvaluation.evaluation.id).outcome.id, correctedOutcome.outcome.id);
  assert.equal(JSON.stringify(correctedRiskState).includes(deviceReference), false);
  await json(await request(`/api/v1/risk/lists/${blockList.entry.id}`, { method: 'DELETE' }), 200);
  await json(await request(`/api/v1/risk/lists/${blockList.entry.id}`, { method: 'DELETE' }), 404);
  await json(await request(`/api/v1/risk/lists/${watchList.entry.id}`, { method: 'DELETE' }), 200);
  const afterDisableEvaluation = await json(await request('/api/v1/risk/evaluations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-list-disabled-${runId}` },
    body: JSON.stringify({ operationType: 'cash_in', amount: '25.00', currency: 'ARS', counterparty: 'QA Device Subject',
      signals: { deviceReference, identityReference, deviceTrust: 'trusted', identityVerified: true } }),
  }), 201);
  assert.equal(afterDisableEvaluation.evaluation.decision, 'approve');
  assert.equal(afterDisableEvaluation.evaluation.matchedListEntryIds.length, 0);

  const lowKey = `qa-low-${runId}`;
  const lowPayload = { counterparty: 'QA Supplier', description: 'Low-risk transfer', amount: '1000.00', currency: 'ARS' };
  const low = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': lowKey }, body: JSON.stringify(lowPayload),
  }), 201);
  assert.equal(low.transaction.status, 'settled');
  const replay = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': lowKey }, body: JSON.stringify(lowPayload),
  }), 200);
  assert.equal(replay.replayed, true);
  const mismatch = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': lowKey },
    body: JSON.stringify({ ...lowPayload, amount: '1001.00' }),
  }), 409);
  assert.equal(mismatch.error.code, 'idempotency_mismatch');

  const high = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-high-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Marketplace', description: 'Review transfer', amount: '2000000', currency: 'ARS' }),
  }), 201);
  assert.equal(high.transaction.status, 'review');
  const notPresented = await json(await request('/api/v1/disputes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-not-presented-${runId}` },
    body: JSON.stringify({ transactionId: high.transaction.id, reason: 'other', description: 'No liquidada.', amount: '1.00', currency: 'ARS' }),
  }), 409);
  assert.equal(notPresented.error.code, 'transaction_not_presented');
  const afterHigh = (await json(await request('/api/v1/ledger'), 200)).data;
  const highHold = afterHigh.holds.find((hold) => hold.transactionId === high.transaction.id);
  assert.ok(highHold);
  const captureKey = `qa-capture-${runId}`;
  const captured = await json(await request(`/api/v1/holds/${highHold.id}/capture`, {
    method: 'POST', headers: { 'Idempotency-Key': captureKey },
  }), 200);
  assert.equal(captured.hold.status, 'captured');
  const captureReplay = await json(await request(`/api/v1/holds/${highHold.id}/capture`, {
    method: 'POST', headers: { 'Idempotency-Key': captureKey },
  }), 200);
  assert.equal(captureReplay.hold.replayed, true);
  const captureConflict = await json(await request(`/api/v1/holds/${highHold.id}/release`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-conflict-${runId}` },
  }), 409);
  assert.equal(captureConflict.error.code, 'hold_already_resolved');

  const reversed = await json(await request(`/api/v1/transfers/${low.transaction.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-reverse-${runId}` },
  }), 201);
  assert.equal(reversed.transaction.reversalOf, low.transaction.id);
  const reverseReplay = await json(await request(`/api/v1/transfers/${low.transaction.id}/reverse`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-reverse-${runId}` },
  }), 200);
  assert.equal(reverseReplay.replayed, true);

  const releasable = afterHigh.holds.find((hold) => hold.currency === 'ARS' && hold.id !== highHold.id);
  assert.ok(releasable);
  const releaseKey = `qa-release-${runId}`;
  const released = await json(await request(`/api/v1/holds/${releasable.id}/release`, {
    method: 'POST', headers: { 'Idempotency-Key': releaseKey },
  }), 200);
  assert.equal(released.hold.status, 'released');
  const releaseReplay = await json(await request(`/api/v1/holds/${releasable.id}/release`, {
    method: 'POST', headers: { 'Idempotency-Key': releaseKey },
  }), 200);
  assert.equal(releaseReplay.hold.replayed, true);

  const insufficient = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-insufficient-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Supplier', description: 'Must fail', amount: '9000000', currency: 'ARS' }),
  }), 422);
  assert.equal(insufficient.error.code, 'insufficient_funds');

  const reconciliationStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const reconciliationEnd = new Date(Date.now() + 60_000).toISOString();
  const reconciliation = await json(await request('/api/v1/reconciliation/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-reconciliation-${runId}` },
    body: JSON.stringify({ name: 'QA ledger close', source: 'internal', currency: 'ARS', periodStart: reconciliationStart, periodEnd: reconciliationEnd, entries: [] }),
  }), 201);
  const reconciliationState = (await json(await request('/api/v1/reconciliation'), 200)).data;
  const runExceptions = reconciliationState.exceptions.filter((item) => item.runId === reconciliation.run.id && item.status === 'open');
  assert.equal(runExceptions.length, reconciliation.run.exceptionCount);
  for (const item of runExceptions) {
    await json(await request(`/api/v1/reconciliation/exceptions/${item.id}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-exception-${item.id}` },
      body: JSON.stringify({ resolution: 'accepted', note: 'Aceptada por el E2E para cerrar el ciclo.' }),
    }), 200);
  }
  const cycle = await json(await request('/api/v1/settlements', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-settlement-${runId}` },
    body: JSON.stringify({ reconciliationRunId: reconciliation.run.id, name: 'QA settlement cycle' }),
  }), 201);
  assert.equal(cycle.cycle.status, 'ready');
  const approvalPending = await json(await request(`/api/v1/settlements/${cycle.cycle.id}/execute`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-settlement-execute-${runId}` },
  }), 202);
  assert.equal(approvalPending.requiresApproval, true);
  assert.equal(approvalPending.approval.status, 'pending');
  await json(await request(`/api/v1/approvals/${approvalPending.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-approval-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  const ownerCookieAfterRequest = cookie;
  cookie = checkerCookie;
  const approvalDecisionKey = `qa-approval-checker-${runId}`;
  const settled = await json(await request(`/api/v1/approvals/${approvalPending.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approvalDecisionKey },
    body: JSON.stringify({ reason: 'QA independent checker approval' }),
  }), 200);
  assert.equal(settled.approval.status, 'executed');
  const approvalReplay = await json(await request(`/api/v1/approvals/${approvalPending.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approvalDecisionKey },
    body: JSON.stringify({ reason: 'QA independent checker approval' }),
  }), 200);
  assert.equal(approvalReplay.replayed, true);
  await json(await request(`/api/v1/approvals/${approvalPending.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': approvalDecisionKey },
    body: JSON.stringify({ reason: 'Changed payload must conflict' }),
  }), 409);
  cookie = ownerCookieAfterRequest;
  assert.equal(settled.cycle.status, 'settled');
  const approvalReadKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA approvals reader', scopes: ['approvals:read'], expiresInDays: 1 }),
  }), 201);
  const approvalList = await json(await fetch(new URL('/api/v1/approvals', target), {
    headers: { Authorization: `Bearer ${approvalReadKey.secret}` },
  }), 200);
  assert.equal(approvalList.data.some((item) => item.id === approvalPending.approval.id && item.status === 'executed'), true);
  await json(await request(`/api/platform/api-keys/${approvalReadKey.key.id}`, { method: 'DELETE' }), 200);

  const transferPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'transfer.create', enabled: true, expiresInMinutes: 1440 }),
  }), 200);
  assert.equal(transferPolicy.policy.actionType, 'transfer.create');
  assert.equal(transferPolicy.policy.enabled, true);
  const protectedTransferPayload = { counterparty: 'QA Protected Supplier', description: 'Maker checker transfer', amount: '25.00', currency: 'ARS',
    signals: { deviceReference, identityReference, deviceTrust: 'trusted', identityVerified: true } };
  const protectedTransfer = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-transfer-${runId}` },
    body: JSON.stringify(protectedTransferPayload),
  }), 202);
  assert.equal(protectedTransfer.requiresApproval, true);
  assert.equal(protectedTransfer.approval.actionType, 'transfer.create');
  assert.deepEqual(protectedTransfer.approval.requestPayload.signals, { deviceReferencePresent: true, identityReferencePresent: true,
    deviceTrust: 'trusted', identityVerified: true });
  assert.equal(JSON.stringify(protectedTransfer).includes(deviceReference), false);
  const protectedTransferReplay = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-transfer-${runId}` },
    body: JSON.stringify(protectedTransferPayload),
  }), 202);
  assert.equal(protectedTransferReplay.replayed, true);
  assert.equal(protectedTransferReplay.approval.id, protectedTransfer.approval.id);
  const protectedTransferMismatch = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-transfer-${runId}` },
    body: JSON.stringify({ ...protectedTransferPayload, signals: { ...protectedTransferPayload.signals, deviceTrust: 'unknown' } }),
  }), 409);
  assert.equal(protectedTransferMismatch.error.code, 'idempotency_mismatch');
  await json(await request(`/api/v1/approvals/${protectedTransfer.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-transfer-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  cookie = checkerCookie;
  const protectedExecution = await json(await request(`/api/v1/approvals/${protectedTransfer.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-transfer-checker-${runId}` },
    body: JSON.stringify({ reason: 'Independent transfer checker' }),
  }), 200);
  assert.equal(protectedExecution.approval.status, 'executed');
  assert.equal(protectedExecution.transaction.id, protectedTransfer.approval.resourceId);
  assert.equal(protectedExecution.transaction.status, 'settled');
  const protectedDecisionReplay = await json(await request(`/api/v1/approvals/${protectedTransfer.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-transfer-checker-${runId}` },
    body: JSON.stringify({ reason: 'Independent transfer checker' }),
  }), 200);
  assert.equal(protectedDecisionReplay.replayed, true);
  assert.equal(protectedDecisionReplay.approval.status, 'executed');
  cookie = ownerCookieAfterRequest;

  const protectedBookPayload = { externalReference: `BT-PROTECTED-${runId}`, sourceAccountId: account.id,
    destinationAccountId: destinationAccount.id, description: 'Maker checker book transfer', amount: '10.00', currency: 'ARS' };
  const protectedBook = await json(await request('/api/v1/book-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-book-${runId}` },
    body: JSON.stringify(protectedBookPayload),
  }), 202);
  assert.equal(protectedBook.requiresApproval, true); assert.equal(protectedBook.approval.resourceType, 'book_transfer');
  await json(await request(`/api/v1/approvals/${protectedBook.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-book-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  cookie = checkerCookie;
  const protectedBookExecution = await json(await request(`/api/v1/approvals/${protectedBook.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-book-checker-${runId}` },
    body: JSON.stringify({ reason: 'Independent book transfer checker' }),
  }), 200);
  assert.equal(protectedBookExecution.approval.status, 'executed');
  assert.equal(protectedBookExecution.bookTransfer.id, protectedBook.approval.resourceId);
  assert.equal(protectedBookExecution.bookTransfer.status, 'settled');
  cookie = ownerCookieAfterRequest;

  const unfundedTransfer = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-unfunded-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Protected Supplier', description: 'Approval-time balance recheck', amount: '9000000', currency: 'ARS' }),
  }), 202);
  cookie = checkerCookie;
  const unfundedDecision = await json(await request(`/api/v1/approvals/${unfundedTransfer.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-transfer-unfunded-checker-${runId}` },
    body: JSON.stringify({ reason: 'Validate approval-time funds' }),
  }), 422);
  assert.equal(unfundedDecision.error.code, 'insufficient_funds');
  const failedApproval = await json(await request(`/api/v1/approvals/${unfundedTransfer.approval.id}`), 200);
  assert.equal(failedApproval.status, 'failed');
  cookie = ownerCookieAfterRequest;

  const csv = new FormData();
  csv.set('name', 'QA CSV import'); csv.set('source', 'bank'); csv.set('currency', 'ARS');
  csv.set('periodStart', new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());
  csv.set('periodEnd', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());
  csv.set('file', new File(['external_reference,transaction_id,direction,amount\nQA-BANK-1,,credit,10.00'], 'qa-bank.csv', { type: 'text/csv' }));
  const imported = await json(await request('/api/v1/reconciliation/imports', {
    method: 'POST', headers: { 'Idempotency-Key': `qa-import-${runId}` }, body: csv,
  }), 201);
  assert.equal(imported.import.rowCount, 1);
  assert.equal(imported.run.ingestionMode, 'csv');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('file', new File([png], 'qa-evidence.png', { type: 'image/png' }));
  const evidenceDocument = await json(await request('/api/v1/compliance/documents', { method: 'POST', body: form }), 201);

  const dueCaseKey = `qa-kyb-case-${runId}`;
  const dueCase = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': dueCaseKey },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 90 }),
  }), 201);
  assert.equal(dueCase.case.kind, 'kyb'); assert.equal(dueCase.case.status, 'draft');
  const dueCaseReplay = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': dueCaseKey },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 90 }),
  }), 200);
  assert.equal(dueCaseReplay.replayed, true); assert.equal(dueCaseReplay.case.id, dueCase.case.id);
  const dueCaseMismatch = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': dueCaseKey },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 180 }),
  }), 409);
  assert.equal(dueCaseMismatch.error.code, 'idempotency_mismatch');
  const prematureSubmission = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/submit`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-kyb-premature-${runId}` },
  }), 409);
  assert.equal(prematureSubmission.error.code, 'due_diligence_requirements_missing');

  await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/parties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-representative-${runId}` },
    body: JSON.stringify({ role: 'legal_representative', name: 'Ana Representante', taxId: '20111222333', pepDeclared: false }),
  }), 201);
  await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/parties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-owner-${runId}` },
    body: JSON.stringify({ role: 'beneficial_owner', name: 'Bruno Beneficiario', taxId: '20222333444', ownershipPercentage: 60, pepDeclared: false }),
  }), 201);
  const ownershipExceeded = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/parties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-owner-exceeded-${runId}` },
    body: JSON.stringify({ role: 'beneficial_owner', name: 'Carla Beneficiaria', taxId: '20333444555', ownershipPercentage: 50 }),
  }), 409);
  assert.equal(ownershipExceeded.error.code, 'due_diligence_ownership_exceeded');
  for (const checkType of ['business_registry', 'sanctions', 'pep', 'beneficial_ownership']) {
    const check = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/checks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-check-${checkType}-${runId}` },
      body: JSON.stringify({ checkType, source: checkType === 'sanctions' ? 'official_registry' : 'manual_review', status: 'passed',
        resultCode: 'verified_qa', note: `Control ${checkType} documentado por QA.`, evidenceDocumentId: evidenceDocument.document.id }),
    }), 201);
    assert.equal(check.check.checkType, checkType);
  }
  const readyCase = (await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}`), 200)).data;
  assert.equal(readyCase.readyForReview, true); assert.equal(readyCase.checks.length, 4); assert.equal(readyCase.parties.length, 2);
  const submittedDueCase = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/submit`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-kyb-submit-${runId}` },
  }), 200);
  assert.equal(submittedDueCase.case.status, 'in_review');
  const selfDueDecision = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-self-${runId}` },
    body: JSON.stringify({ decision: 'approve', riskRating: 'low', note: 'El maker no debe decidir.' }),
  }), 409);
  assert.equal(selfDueDecision.error.code, 'due_diligence_self_decision');
  const cddKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA CDD orchestrator', scopes: ['compliance:read', 'compliance:write'], expiresInDays: 1 }),
  }), 201);
  const cddStateByApi = await json(await fetch(new URL('/api/v1/due-diligence', target), { headers: { Authorization: `Bearer ${cddKey.secret}` } }), 200);
  assert.equal(cddStateByApi.data.cases.some((item) => item.id === dueCase.case.id), true);
  const machineDecisionDenied = await json(await fetch(new URL(`/api/v1/due-diligence/cases/${dueCase.case.id}/decide`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${cddKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-machine-${runId}` },
    body: JSON.stringify({ decision: 'approve', riskRating: 'low', note: 'Una API key no decide.' }),
  }), 403);
  assert.equal(machineDecisionDenied.error.code, 'session_required');
  await json(await request(`/api/platform/api-keys/${cddKey.key.id}`, { method: 'DELETE' }), 200);
  cookie = checkerCookie;
  const dueDecisionKey = `qa-kyb-checker-${runId}`;
  const decidedDueCase = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': dueDecisionKey },
    body: JSON.stringify({ decision: 'approve', riskRating: 'low', note: 'Evidencia completa y control independiente.' }),
  }), 200);
  assert.equal(decidedDueCase.case.status, 'approved'); assert.equal(decidedDueCase.case.resolvedByName, 'Cimbra Checker');
  const dueDecisionReplay = await json(await request(`/api/v1/due-diligence/cases/${dueCase.case.id}/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': dueDecisionKey },
    body: JSON.stringify({ decision: 'approve', riskRating: 'low', note: 'Evidencia completa y control independiente.' }),
  }), 200);
  assert.equal(dueDecisionReplay.replayed, true);
  cookie = ownerCookieAfterRequest;
  const cancelledDueCase = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-cancel-create-${runId}` },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 30 }),
  }), 201);
  const cancelledDueResult = await json(await request(`/api/v1/due-diligence/cases/${cancelledDueCase.case.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-cancel-${runId}` },
    body: JSON.stringify({ note: 'Caso duplicado para validar cancelación.' }),
  }), 200);
  assert.equal(cancelledDueResult.case.status, 'cancelled');
  const expiringDueCase = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-kyb-expire-create-${runId}` },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 30 }),
  }), 201);
  await sql`UPDATE due_diligence_cases SET expires_at = ${new Date(Date.now() - 60_000).toISOString()} WHERE id = ${expiringDueCase.case.id}`;
  const expiredDueCase = (await json(await request(`/api/v1/due-diligence/cases/${expiringDueCase.case.id}`), 200)).data;
  assert.equal(expiredDueCase.status, 'expired');

  const operations = (await json(await request('/api/v1/operations/work-items'), 200)).data;
  const operationalCase = operations.workItems.find((item) => item.type === 'risk_case' && item.metadata.transactionId === high.transaction.id);
  const operationalOwnerMember = operations.members.find((member) => member.email === email);
  assert.ok(operationalCase); assert.ok(operationalOwnerMember); assert.equal(operationalCase.status, 'open');
  const workUpdateKey = `qa-work-update-${runId}`;
  const workUpdate = { assignedToUserId: operationalOwnerMember.userId, priority: 'high', dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), escalated: true };
  const updatedWork = await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': workUpdateKey }, body: JSON.stringify(workUpdate),
  }), 200);
  assert.equal(updatedWork.workItem.assignee.userId, operationalOwnerMember.userId); assert.equal(updatedWork.workItem.priority, 'high');
  const updateReplay = await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': workUpdateKey }, body: JSON.stringify(workUpdate),
  }), 200);
  assert.equal(updateReplay.replayed, true);
  await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': workUpdateKey }, body: JSON.stringify({ priority: 'medium' }),
  }), 409);
  const noteKey = `qa-work-note-${runId}`;
  await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': noteKey }, body: JSON.stringify({ body: 'Contexto validado por el E2E operativo.' }),
  }), 201);
  const noteReplay = await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': noteKey }, body: JSON.stringify({ body: 'Contexto validado por el E2E operativo.' }),
  }), 200);
  assert.equal(noteReplay.replayed, true);
  const evidenceKey = `qa-work-evidence-${runId}`;
  await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': evidenceKey }, body: JSON.stringify({ documentId: evidenceDocument.document.id }),
  }), 201);
  const evidenceReplay = await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': evidenceKey }, body: JSON.stringify({ documentId: evidenceDocument.document.id }),
  }), 200);
  assert.equal(evidenceReplay.replayed, true);
  const operationsKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA operations SDK', scopes: ['operations:read', 'operations:write'], expiresInDays: 1 }),
  }), 201);
  await json(await fetch(new URL('/api/v1/operations/work-items', target), {
    headers: { Authorization: `Bearer ${operationsKey.secret}` },
  }), 200);
  await json(await fetch(new URL(`/api/v1/operations/work-items/risk-case/${operationalCase.id}/notes`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${operationsKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-work-api-note-${runId}` },
    body: JSON.stringify({ body: 'Seguimiento agregado mediante credencial S2S.' }),
  }), 201);
  await json(await request(`/api/platform/api-keys/${operationsKey.key.id}`, { method: 'DELETE' }), 200);

  const disputeState = (await json(await request('/api/v1/disputes'), 200)).data;
  assert.ok(disputeState.eligibleTransactions.some((item) => item.id === cashOut.payment.id));
  const disputeKey = `qa-dispute-${runId}`;
  const disputePayload = { transactionId: cashOut.payment.id, reason: 'service_not_received',
    description: 'Servicio no recibido; evidencia privada disponible.', amount: '25.00', currency: 'ARS', provisionalCreditRequested: true };
  const openedDispute = await json(await request('/api/v1/disputes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': disputeKey }, body: JSON.stringify(disputePayload),
  }), 201);
  assert.equal(openedDispute.dispute.status, 'opened'); assert.equal(openedDispute.dispute.creditStatus, 'none');
  const disputeReplay = await json(await request('/api/v1/disputes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': disputeKey }, body: JSON.stringify(disputePayload),
  }), 200);
  assert.equal(disputeReplay.replayed, true); assert.equal(disputeReplay.dispute.id, openedDispute.dispute.id);
  await json(await request('/api/v1/disputes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': disputeKey },
    body: JSON.stringify({ ...disputePayload, amount: '20.00' }),
  }), 409);
  const disputesApiKey = await json(await request('/api/platform/api-keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'QA disputes SDK', scopes: ['disputes:read', 'disputes:write'], expiresInDays: 1 }),
  }), 201);
  const machineDisputes = await json(await fetch(new URL('/api/v1/disputes', target), {
    headers: { Authorization: `Bearer ${disputesApiKey.secret}` },
  }), 200);
  assert.equal(machineDisputes.data.disputes.some((item) => item.id === openedDispute.dispute.id), true);
  const reviewDispute = await json(await fetch(new URL(`/api/v1/disputes/${openedDispute.dispute.id}/events`, target), {
    method: 'POST', headers: { Authorization: `Bearer ${disputesApiKey.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-review-${runId}` },
    body: JSON.stringify({ event: 'start_review', note: 'Operaciones validó evidencia inicial.' }),
  }), 200);
  assert.equal(reviewDispute.dispute.status, 'under_review'); assert.equal(reviewDispute.dispute.creditStatus, 'posted');
  assert.ok(reviewDispute.dispute.creditTransactionId);
  await json(await fetch(new URL(`/api/v1/disputes/${openedDispute.dispute.id}`, target), {
    headers: { Authorization: `Bearer ${disputesApiKey.secret}` },
  }), 200);
  await json(await request(`/api/platform/api-keys/${disputesApiKey.key.id}`, { method: 'DELETE' }), 200);
  const disputeDetail = (await json(await request(`/api/v1/disputes/${openedDispute.dispute.id}`), 200)).data;
  assert.equal(disputeDetail.events.length, 2); assert.equal(disputeDetail.events[1].event, 'start_review');
  const disputeEvidenceKey = `qa-dispute-evidence-${runId}`;
  await json(await request(`/api/v1/operations/work-items/dispute/${openedDispute.dispute.id}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': disputeEvidenceKey },
    body: JSON.stringify({ documentId: evidenceDocument.document.id }),
  }), 201);
  await json(await request(`/api/v1/operations/work-items/dispute/${openedDispute.dispute.id}/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-note-${runId}` },
    body: JSON.stringify({ body: 'Documento de soporte validado para la disputa.' }),
  }), 201);
  const operationsWithDispute = (await json(await request('/api/v1/operations/work-items'), 200)).data;
  const disputeWorkItem = operationsWithDispute.workItems.find((item) => item.type === 'dispute' && item.id === openedDispute.dispute.id);
  assert.ok(disputeWorkItem); assert.equal(disputeWorkItem.open, true); assert.equal(disputeWorkItem.evidenceCount, 1);
  await json(await request(`/api/v1/disputes/${openedDispute.dispute.id}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-network-ready-${runId}` },
    body: JSON.stringify({ event: 'mark_network_ready', note: 'Expediente preparado; no enviado a ninguna red.' }),
  }), 200);
  const disputePolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'dispute.resolve', enabled: true, expiresInMinutes: 60 }),
  }), 200);
  assert.equal(disputePolicy.policy.enabled, true);
  const disputeResolution = await json(await request(`/api/v1/disputes/${openedDispute.dispute.id}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-lost-${runId}` },
    body: JSON.stringify({ event: 'resolve_lost', note: 'La evidencia no sustenta el reclamo.' }),
  }), 202);
  assert.equal(disputeResolution.requiresApproval, true); assert.equal(disputeResolution.approval.actionType, 'dispute.resolve');
  await json(await request(`/api/v1/approvals/${disputeResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  cookie = checkerCookie;
  const executedDispute = await json(await request(`/api/v1/approvals/${disputeResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-dispute-checker-${runId}` },
    body: JSON.stringify({ reason: 'QA checker revisó expediente y evidencia.' }),
  }), 200);
  assert.equal(executedDispute.approval.status, 'executed'); assert.equal(executedDispute.dispute.status, 'lost');
  assert.equal(executedDispute.dispute.creditStatus, 'reversed'); assert.ok(executedDispute.dispute.creditReversalTransactionId);
  cookie = ownerCookieAfterRequest;

  const disabledTransferPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'transfer.create', enabled: false, expiresInMinutes: 1440 }),
  }), 200);
  assert.equal(disabledTransferPolicy.policy.enabled, false);
  const riskResolutionPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'risk.case.resolve', enabled: true, expiresInMinutes: 60 }),
  }), 200);
  assert.equal(riskResolutionPolicy.policy.enabled, true);
  const protectedRiskTransfer = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-protected-transfer-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Risk Review', description: 'Protected risk resolution', amount: '2000000', currency: 'ARS' }),
  }), 201);
  assert.equal(protectedRiskTransfer.transaction.status, 'review');
  const protectedRiskState = (await json(await request('/api/v1/risk'), 200)).data;
  const protectedRiskCase = protectedRiskState.cases.find((item) => item.transactionId === protectedRiskTransfer.transaction.id);
  assert.ok(protectedRiskCase?.holdId);
  const holdBypass = await json(await request(`/api/v1/holds/${protectedRiskCase.holdId}/capture`, {
    method: 'POST', headers: { 'Idempotency-Key': `qa-risk-hold-bypass-${runId}` },
  }), 409);
  assert.equal(holdBypass.error.code, 'risk_case_approval_required');
  const riskResolutionKey = `qa-risk-resolution-${runId}`;
  const protectedRiskResolution = await json(await request(`/api/v1/risk/cases/${protectedRiskCase.id}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': riskResolutionKey },
    body: JSON.stringify({ resolution: 'approved', note: 'QA maker solicita liberar la decisión de riesgo.' }),
  }), 202);
  assert.equal(protectedRiskResolution.requiresApproval, true);
  assert.equal(protectedRiskResolution.approval.actionType, 'risk.case.resolve');
  const riskResolutionReplay = await json(await request(`/api/v1/risk/cases/${protectedRiskCase.id}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': riskResolutionKey },
    body: JSON.stringify({ resolution: 'approved', note: 'QA maker solicita liberar la decisión de riesgo.' }),
  }), 202);
  assert.equal(riskResolutionReplay.replayed, true);
  const riskResolutionConflict = await json(await request(`/api/v1/risk/cases/${protectedRiskCase.id}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-resolution-conflict-${runId}` },
    body: JSON.stringify({ resolution: 'declined', note: 'QA intenta una decisión opuesta sobre el mismo caso.' }),
  }), 409);
  assert.equal(riskResolutionConflict.error.code, 'approval_request_conflict');
  await json(await request(`/api/v1/approvals/${protectedRiskResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  cookie = checkerCookie;
  const executedRiskResolution = await json(await request(`/api/v1/approvals/${protectedRiskResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-checker-${runId}` },
    body: JSON.stringify({ reason: 'QA checker valida evidencia y contraparte.' }),
  }), 200);
  assert.equal(executedRiskResolution.approval.status, 'executed');
  assert.equal(executedRiskResolution.case.status, 'resolved');
  assert.equal(executedRiskResolution.case.resolution, 'approved');
  cookie = ownerCookieAfterRequest;

  const exceptionResolutionPolicy = await json(await request('/api/platform/approval-policy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'reconciliation.exception.resolve', enabled: true, expiresInMinutes: 60 }),
  }), 200);
  assert.equal(exceptionResolutionPolicy.policy.enabled, true);
  const protectedReconciliation = await json(await request('/api/v1/reconciliation/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-protected-reconciliation-${runId}` },
    body: JSON.stringify({ name: 'QA protected difference', source: 'bank', currency: 'ARS',
      periodStart: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      entries: [{ externalReference: `QA-PROTECTED-${runId}`, direction: 'credit', amount: '10.00' }] }),
  }), 201);
  const protectedReconciliationState = (await json(await request('/api/v1/reconciliation'), 200)).data;
  const protectedException = protectedReconciliationState.exceptions.find((item) => item.runId === protectedReconciliation.run.id && item.status === 'open');
  assert.ok(protectedException);
  const exceptionResolutionKey = `qa-exception-resolution-${runId}`;
  const protectedExceptionResolution = await json(await request(`/api/v1/reconciliation/exceptions/${protectedException.id}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': exceptionResolutionKey },
    body: JSON.stringify({ resolution: 'accepted', note: 'QA maker documenta diferencia tolerada.' }),
  }), 202);
  assert.equal(protectedExceptionResolution.requiresApproval, true);
  assert.equal(protectedExceptionResolution.approval.actionType, 'reconciliation.exception.resolve');
  await json(await request(`/api/v1/approvals/${protectedExceptionResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-exception-self-${runId}` },
    body: JSON.stringify({ reason: 'self approval must fail' }),
  }), 409);
  cookie = checkerCookie;
  const executedExceptionResolution = await json(await request(`/api/v1/approvals/${protectedExceptionResolution.approval.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-exception-checker-${runId}` },
    body: JSON.stringify({ reason: 'QA checker valida soporte de conciliación.' }),
  }), 200);
  assert.equal(executedExceptionResolution.approval.status, 'executed');
  assert.equal(executedExceptionResolution.exception.status, 'accepted');
  cookie = ownerCookieAfterRequest;

  const finalAccess = await json(await request('/api/platform/access'), 200);
  const checkerMember = finalAccess.data.members.find((member) => member.email === checkerEmail);
  assert.ok(checkerMember);
  await json(await request(`/api/platform/access/members/${checkerMember.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }),
  }), 200);
  cookie = checkerCookie;
  await json(await request('/api/v1/ledger'), 200);
  await json(await request('/api/v1/operations/work-items'), 200);
  await json(await request('/api/v1/disputes'), 200);
  await json(await request('/api/v1/due-diligence'), 200);
  await json(await request('/api/v1/billers'), 200);
  await json(await request('/api/v1/bill-payments'), 200);
  await json(await request('/api/v1/recurring-mandates'), 200);
  await json(await request('/api/v1/payout-beneficiaries'), 200);
  await json(await request('/api/v1/payout-batches'), 200);
  await json(await request('/api/v1/book-transfers'), 200);
  await json(await request('/api/v1/wallets'), 200);
  await json(await request('/api/v1/wallet-programs'), 200);
  await json(await request('/api/v1/rail-instruments'), 200);
  await json(await request('/api/v1/instant-transfers'), 200);
  await json(await request('/api/v1/debit-requests'), 200);
  await json(await request('/api/v1/payment-qrs'), 200);
  await json(await request('/api/v1/qr-sale-orders'), 200);
  await json(await request('/api/v1/qr-debts'), 200);
  await json(await request('/api/v1/payment-links'), 200);
  await json(await request('/api/v1/collection-tills'), 200);
  await json(await request('/api/v1/echeqs'), 200);
  await json(await request(`/api/v1/accounts/${account.id}/statement`), 200);
  await json(await request(`/api/v1/cards/${card.id}/lifecycle`), 200);
  assert.equal((await request('/console')).status, 200);
  const viewerWriteDenied = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-denied-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Denied', description: 'Viewer cannot mutate', amount: '1.00', currency: 'ARS' }),
  }), 403);
  assert.equal(viewerWriteDenied.error.code, 'insufficient_role');
  const viewerBookTransferDenied = await json(await request('/api/v1/book-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-book-${runId}` },
    body: JSON.stringify({ ...bookTransferPayload, externalReference: `BT-VIEWER-${runId}` }),
  }), 403);
  assert.equal(viewerBookTransferDenied.error.code, 'insufficient_role');
  const viewerWalletDenied = await json(await request('/api/v1/wallet-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-wallet-program-${runId}` },
    body: JSON.stringify({ name: 'Viewer denied', displayName: 'Viewer denied', defaultCurrency: 'ARS' }),
  }), 403);
  assert.equal(viewerWalletDenied.error.code, 'insufficient_role');
  const viewerInstantDenied = await json(await request('/api/v1/instant-transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-instant-${runId}` },
    body: JSON.stringify({
      externalReference: `IP-VIEWER-${runId}`, accountId: account.id, destination: '0110023500000000012342', description: 'Viewer',
      amount: '1.00', currency: 'ARS', confirmHolder: true, holderName: 'QA Company', taxIdLast4: '5678',
    }),
  }), 403);
  assert.equal(viewerInstantDenied.error.code, 'insufficient_role');
  const viewerSaleOrderDenied = await json(await request('/api/v1/qr-sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-ov-${runId}` },
    body: JSON.stringify({
      paymentQrId: staticAgain.qr.id, externalReference: `OV-VIEWER-${runId}`, description: 'Viewer', amount: '1.00', currency: 'ARS',
    }),
  }), 403);
  assert.equal(viewerSaleOrderDenied.error.code, 'insufficient_role');
  const viewerDebtDenied = await json(await request('/api/v1/qr-debts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-debt-${runId}` },
    body: JSON.stringify({
      accountId: account.id, externalReference: `DEUDA-VIEWER-${runId}`, description: 'Viewer', amount: '1.00', currency: 'ARS',
    }),
  }), 403);
  assert.equal(viewerDebtDenied.error.code, 'insufficient_role');
  const viewerCollectionDenied = await json(await request('/api/v1/payment-links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-link-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `FAC-VIEWER-${runId}`, description: 'Viewer',
      amount: '1.00', currency: 'ARS',
    }),
  }), 403);
  assert.equal(viewerCollectionDenied.error.code, 'insufficient_role');
  const viewerTillDenied = await json(await request('/api/v1/collection-tills', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-till-${runId}` },
    body: JSON.stringify({
      accountId: destinationAccount.id, externalReference: `TILL-VIEWER-${runId}`, name: 'Viewer',
    }),
  }), 403);
  assert.equal(viewerTillDenied.error.code, 'insufficient_role');
  const viewerEcheqDenied = await json(await request('/api/v1/echeqs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-echeq-${runId}` },
    body: JSON.stringify({
      drawerAccountId: account.id, externalReference: `CHQ-VIEWER-${runId}`, description: 'Viewer',
      amount: '1.00', currency: 'ARS', beneficiaryName: 'QA Company', beneficiaryTaxId: '30000075678',
    }),
  }), 403);
  assert.equal(viewerEcheqDenied.error.code, 'insufficient_role');
  const viewerOperationsDenied = await json(await request(`/api/v1/operations/work-items/risk-case/${operationalCase.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-work-${runId}` }, body: JSON.stringify({ priority: 'low' }),
  }), 403);
  assert.equal(viewerOperationsDenied.error.code, 'insufficient_role');
  const viewerDisputeDenied = await json(await request(`/api/v1/disputes/${openedDispute.dispute.id}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-dispute-${runId}` },
    body: JSON.stringify({ event: 'cancel', note: 'Viewer cannot mutate.' }),
  }), 403);
  assert.equal(viewerDisputeDenied.error.code, 'insufficient_role');
  const viewerStepUpDenied = await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/step-up-challenges`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-step-up-${runId}` },
    body: JSON.stringify({ method: 'otp', delivery: 'client_managed' }),
  }), 403);
  assert.equal(viewerStepUpDenied.error.code, 'insufficient_role');
  const viewerProgramDenied = await json(await request('/api/v1/card-programs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-card-program-${runId}` },
    body: JSON.stringify({ name: 'Viewer denied', product: 'debit', formats: ['virtual'], defaultCurrency: 'ARS' }),
  }), 403);
  assert.equal(viewerProgramDenied.error.code, 'insufficient_role');
  const viewerDueDiligenceDenied = await json(await request('/api/v1/due-diligence/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-cdd-${runId}` },
    body: JSON.stringify({ customerId: customer.id, expiresInDays: 30 }),
  }), 403);
  assert.equal(viewerDueDiligenceDenied.error.code, 'insufficient_role');
  const viewerBillerDenied = await json(await request('/api/v1/billers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-biller-${runId}` }, body: JSON.stringify(billerPayload),
  }), 403);
  assert.equal(viewerBillerDenied.error.code, 'insufficient_role');
  const viewerBillPaymentDenied = await json(await request('/api/v1/bill-payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-bill-payment-${runId}` },
    body: JSON.stringify({ accountId: account.id, billerId: topup.id, destinationReference: '5491100001234', amount: '5.00' }),
  }), 403);
  assert.equal(viewerBillPaymentDenied.error.code, 'insufficient_role');
  const viewerMandateDenied = await json(await request('/api/v1/recurring-mandates', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-mandate-${runId}` }, body: JSON.stringify(mandatePayload),
  }), 403);
  assert.equal(viewerMandateDenied.error.code, 'insufficient_role');
  const viewerPayoutBeneficiaryDenied = await json(await request('/api/v1/payout-beneficiaries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-payout-beneficiary-${runId}` },
    body: JSON.stringify({ ...payoutBeneficiaryPayload, externalReference: `VIEWER-BEN-${runId}`, destination: `viewer.${runId}` }),
  }), 403);
  assert.equal(viewerPayoutBeneficiaryDenied.error.code, 'insufficient_role');
  const viewerPayoutBatchDenied = await json(await request('/api/v1/payout-batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-payout-batch-${runId}` },
    body: JSON.stringify({ ...payoutBatchPayload, externalReference: `VIEWER-PAY-${runId}`,
      items: [{ ...payoutBatchPayload.items[0], externalReference: `VIEWER-PAY-ITEM-${runId}` }] }),
  }), 403);
  assert.equal(viewerPayoutBatchDenied.error.code, 'insufficient_role');
  const viewerCredentialsDenied = await json(await request('/api/platform/api-keys'), 403);
  assert.equal(viewerCredentialsDenied.code, 'insufficient_role');
  const viewerSupportDenied = await json(await request('/api/v1/support/cases', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-support-${runId}` },
    body: JSON.stringify({ category: 'api', subject: 'Viewer no puede abrir', message: 'Este caso no debería crearse.' }),
  }), 403);
  assert.equal(viewerSupportDenied.error.code, 'insufficient_role');
  const viewerOrgDenied = await json(await request('/api/v1/organization', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-org-${runId}` },
    body: JSON.stringify({ name: 'Viewer no puede' }),
  }), 403);
  assert.equal(viewerOrgDenied.error.code, 'insufficient_role');
  cookie = ownerCookieAfterRequest;
  await json(await request(`/api/platform/access/members/${checkerMember.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
  }), 200);

  const events = [];
  let auditCursor = null;
  do {
    const page = await json(await request(`/api/v1/events?limit=25${auditCursor ? `&cursor=${encodeURIComponent(auditCursor)}` : ''}`), 200);
    events.push(...page.data); auditCursor = page.hasMore ? page.nextCursor : null;
  } while (auditCursor);
  assert.ok(events.some((event) => event.action === 'transfer.reversed'));
  assert.ok(events.some((event) => event.action === 'payment.created'));
  assert.ok(events.some((event) => event.action === 'payment.reversed'));
  assert.ok(events.some((event) => event.action === 'operations.evidence_linked'));
  assert.ok(events.some((event) => event.action === 'dispute.start_review'));
  assert.ok(events.some((event) => event.action === 'dispute.resolve_lost'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_challenge_verified'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_attempt_failed'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_challenge_expired'));
  assert.ok(events.some((event) => event.action === 'due_diligence.approved'));
  assert.ok(events.some((event) => event.action === 'due_diligence.expired'));
  assert.ok(events.some((event) => event.action === 'biller.created'));
  assert.ok(events.some((event) => event.action === 'bill_payment.order_reversed'));
  assert.ok(events.some((event) => event.action === 'recurring_mandate.cancelled'));
  assert.ok(events.some((event) => event.action === 'payout.beneficiary_created'));
  assert.ok(events.some((event) => event.action === 'payout.batch_completed'));
  assert.ok(events.some((event) => event.action === 'payout.batch_cancelled'));
  assert.ok(events.some((event) => event.action === 'payout.item_settled'));
  assert.ok(events.some((event) => event.action === 'payout.item_failed' && event.payload.failureCode === 'payout_reversed'));
  assert.ok(events.some((event) => event.action === 'book_transfer.created'));
  assert.ok(events.some((event) => event.action === 'book_transfer.reversed'));
  assert.ok(events.some((event) => event.action === 'organization.updated'));
  assert.ok(events.some((event) => event.action === 'support.case_opened'));
  assert.ok(events.some((event) => event.action === 'support.message_added'));
  assert.ok(events.some((event) => event.action === 'support.status_updated'));
  assert.ok(events.every((event) => typeof event.payload === 'object'));

  const [integrity] = await sql`
    SELECT COUNT(*)::int AS invalid
    FROM (
      SELECT j.id
      FROM ledger_journals j JOIN ledger_postings p ON p.journal_id = j.id
      JOIN members m ON m.organization_id = j.organization_id
      WHERE m.external_user_id = (SELECT id FROM users WHERE email = ${email})
      GROUP BY j.id
      HAVING COUNT(p.id) < 2 OR SUM(CASE WHEN p.direction = 'debit' THEN p.amount_minor ELSE 0 END)
        <> SUM(CASE WHEN p.direction = 'credit' THEN p.amount_minor ELSE 0 END)
    ) invalid_journals
  `;
  assert.equal(integrity.invalid, 0);

  console.log(JSON.stringify({
    ok: true,
    checks: ['auth', 'landing-session-state', 'console-session-guard', 'email-verification', 'password-recovery', 'session-revocation', 'totp-mfa', 'recovery-codes', 'tenant-seed', 'tenant-rbac', 'viewer-read-only', 'member-invitations', 'public-help-status', 'organization-profile', 'service-topology', 'support-cases', 'ops-fail-closed', 'dual-control', 'maker-checker', 'transfer-approval', 'book-transfer-approval', 'approval-replay', 'approval-fail-closed', 'payout-approval', 'risk-case-approval', 'risk-hold-bypass-guard', 'reconciliation-exception-approval', 'disputes', 'partial-dispute', 'dispute-ledger-credit', 'dispute-compensation', 'dispute-approval', 'dispute-evidence', 'dispute-rbac', 'api-v1', 'request-id', 'rate-limit-headers', 'api-keys', 'scopes', 'revocation', 'webhook-security', 'webhook-rotation', 'customers-idempotency', 'accounts-idempotency', 'book-transfers', 'account-statements', 'book-transfer-compensation', 'book-transfer-rbac', 'wallets', 'wallet-pockets', 'wallet-lifecycle', 'wallet-rbac', 'instant-payments', 'cvu-alias', 'alias-assign', 'cvu-revoke', 'holder-confirmation', 'internal-credit', 'sandbox-outbound', 'internal-debit', 'cimbra-qr', 'qr-sale-orders', 'qr-debts', 'instant-return', 'instant-rbac', 'collections', 'payment-links', 'collection-tills', 'collection-internal', 'collection-inbound', 'collection-refund', 'collection-cancel', 'collection-card-denied', 'collection-debt-link', 'collection-till-link', 'collection-rbac', 'echeqs', 'echeq-accept', 'echeq-deposit', 'echeq-cancel', 'echeq-return', 'echeq-nsf', 'echeq-discount-denied', 'echeq-rbac', 'payout-beneficiaries', 'protected-payout-destination', 'payout-batches', 'payout-scheduling', 'payout-result-file', 'payout-compensation', 'payout-rbac', 'payout-s2s', 'billers', 'biller-obligations', 'protected-subscriber-reference', 'bill-payments', 'mobile-topups', 'gift-cards', 'recurring-mandates', 'mandate-consent', 'biller-rbac', 'biller-s2s', 'bill-payment-compensation', 'cdd-kyb', 'cdd-evidence', 'cdd-idempotency', 'cdd-maker-checker', 'cdd-s2s-orchestration', 'cdd-session-only-decision', 'cdd-expiry', 'cdd-rbac', 'card-programs', 'card-lifecycle', 'card-controls', 'card-terminal-state', 'card-rbac', 'cards-idempotency', 'transfers-idempotency', 'holds', 'capture', 'release', 'reversal', 'insufficient-funds', 'risk', 'risk-signals-privacy', 'risk-decision-lists', 'risk-step-up', 'risk-step-up-idempotency', 'risk-step-up-rbac', 'risk-decision-slo', 'risk-confirmed-outcomes', 'risk-supervised-metrics', 'risk-outcome-revisions', 'reconciliation', 'operations-work-queue', 'operations-idempotency', 'operations-evidence', 'operations-rbac', 'csv-import', 'settlement', 'private-evidence', 'audit'],
  }));
} finally {
  await cleanup();
  await sql.end();
}
