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
      await transaction`DELETE FROM reconciliation_exceptions WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM reconciliation_items WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM reconciliation_runs WHERE organization_id = ${organizationId}`;
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
  const cardKey = `qa-card-${runId}`;
  const cardPayload = { accountId: account.id, product: 'debit', format: 'virtual' };
  const card = (await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 201)).card;
  const cardReplay = await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 200);
  assert.equal(cardReplay.card.id, card.id);

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
  await json(await request(`/api/v1/risk/evaluations/${watchedEvaluation.evaluation.id}/outcomes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-risk-outcome-legitimate-${runId}` },
    body: JSON.stringify({ label: 'legitimate', note: 'QA customer confirmation' }),
  }), 201);
  const supervisedRiskState = (await json(await request('/api/v1/risk'), 200)).data;
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
  const viewerCredentialsDenied = await json(await request('/api/platform/api-keys'), 403);
  assert.equal(viewerCredentialsDenied.code, 'insufficient_role');
  cookie = ownerCookieAfterRequest;
  await json(await request(`/api/platform/access/members/${checkerMember.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
  }), 200);

  const events = (await json(await request('/api/v1/events'), 200)).data;
  assert.ok(events.some((event) => event.action === 'transfer.reversed'));
  assert.ok(events.some((event) => event.action === 'operations.evidence_linked'));
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
    checks: ['auth', 'landing-session-state', 'console-session-guard', 'email-verification', 'password-recovery', 'session-revocation', 'totp-mfa', 'recovery-codes', 'tenant-seed', 'tenant-rbac', 'viewer-read-only', 'member-invitations', 'dual-control', 'maker-checker', 'transfer-approval', 'approval-replay', 'approval-fail-closed', 'risk-case-approval', 'risk-hold-bypass-guard', 'reconciliation-exception-approval', 'api-v1', 'request-id', 'rate-limit-headers', 'api-keys', 'scopes', 'revocation', 'webhook-security', 'webhook-rotation', 'customers-idempotency', 'accounts-idempotency', 'cards-idempotency', 'transfers-idempotency', 'holds', 'capture', 'release', 'reversal', 'insufficient-funds', 'risk', 'risk-signals-privacy', 'risk-decision-lists', 'risk-confirmed-outcomes', 'risk-supervised-metrics', 'risk-outcome-revisions', 'reconciliation', 'operations-work-queue', 'operations-idempotency', 'operations-evidence', 'operations-rbac', 'csv-import', 'settlement', 'private-evidence', 'audit'],
  }));
} finally {
  await cleanup();
  await sql.end();
}
