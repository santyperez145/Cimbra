import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { del } from '@vercel/blob';
import postgres from 'postgres';

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
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
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
  const publicLanding = await request('/');
  assert.equal(publicLanding.status, 200);
  const publicLandingHtml = await publicLanding.text();
  assert.match(publicLandingHtml, />Ingresar</);
  assert.match(publicLandingHtml, /SANDBOX OPERATIVO/);

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
  assert.equal(initialLedgerResponse.headers.get('cimbra-version'), '2026-08-29');
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
  const account = (await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': accountKey },
    body: JSON.stringify(accountPayload),
  }), 201)).account;
  const accountReplay = await json(await request('/api/v1/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': accountKey }, body: JSON.stringify(accountPayload),
  }), 200);
  assert.equal(accountReplay.account.id, account.id);
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
  await json(await request(`/api/v1/cards/${card.id}/lifecycle`), 200);
  assert.equal((await request('/console')).status, 200);
  const viewerWriteDenied = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-viewer-denied-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Denied', description: 'Viewer cannot mutate', amount: '1.00', currency: 'ARS' }),
  }), 403);
  assert.equal(viewerWriteDenied.error.code, 'insufficient_role');
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
  const viewerCredentialsDenied = await json(await request('/api/platform/api-keys'), 403);
  assert.equal(viewerCredentialsDenied.code, 'insufficient_role');
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
  assert.ok(events.some((event) => event.action === 'operations.evidence_linked'));
  assert.ok(events.some((event) => event.action === 'dispute.start_review'));
  assert.ok(events.some((event) => event.action === 'dispute.resolve_lost'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_challenge_verified'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_attempt_failed'));
  assert.ok(events.some((event) => event.action === 'risk.step_up_challenge_expired'));
  assert.ok(events.some((event) => event.action === 'due_diligence.approved'));
  assert.ok(events.some((event) => event.action === 'due_diligence.expired'));
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
    checks: ['auth', 'landing-session-state', 'console-session-guard', 'email-verification', 'password-recovery', 'session-revocation', 'totp-mfa', 'recovery-codes', 'tenant-seed', 'tenant-rbac', 'viewer-read-only', 'member-invitations', 'dual-control', 'maker-checker', 'transfer-approval', 'approval-replay', 'approval-fail-closed', 'risk-case-approval', 'risk-hold-bypass-guard', 'reconciliation-exception-approval', 'disputes', 'partial-dispute', 'dispute-ledger-credit', 'dispute-compensation', 'dispute-approval', 'dispute-evidence', 'dispute-rbac', 'api-v1', 'request-id', 'rate-limit-headers', 'api-keys', 'scopes', 'revocation', 'webhook-security', 'webhook-rotation', 'customers-idempotency', 'accounts-idempotency', 'cdd-kyb', 'cdd-evidence', 'cdd-idempotency', 'cdd-maker-checker', 'cdd-s2s-orchestration', 'cdd-session-only-decision', 'cdd-expiry', 'cdd-rbac', 'card-programs', 'card-lifecycle', 'card-controls', 'card-terminal-state', 'card-rbac', 'cards-idempotency', 'transfers-idempotency', 'holds', 'capture', 'release', 'reversal', 'insufficient-funds', 'risk', 'risk-signals-privacy', 'risk-decision-lists', 'risk-step-up', 'risk-step-up-idempotency', 'risk-step-up-rbac', 'risk-decision-slo', 'risk-confirmed-outcomes', 'risk-supervised-metrics', 'risk-outcome-revisions', 'reconciliation', 'operations-work-queue', 'operations-idempotency', 'operations-evidence', 'operations-rbac', 'csv-import', 'settlement', 'private-evidence', 'audit'],
  }));
} finally {
  await cleanup();
  await sql.end();
}
