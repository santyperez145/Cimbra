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
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
let cookie = '';
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
      await transaction`DELETE FROM members WHERE organization_id = ${organizationId}`;
      await transaction`DELETE FROM organizations WHERE id = ${organizationId}`;
    });
  }
  await sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  for (const identityHash of authAttemptHashes) await sql`DELETE FROM auth_attempts WHERE identity_hash = ${identityHash}`;
}

try {
  const health = await json(await request('/api/health'), 200);
  assert.equal(health.status, 'ok');
  assert.equal(health.dependencies.database, 'ok');

  trackAuthAttempt('register', email);
  const registration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Cimbra QA', username, email, password }),
  });
  await json(registration, 201);
  cookie = registration.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert.match(cookie, /cimbra_session=/);

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

  const initialLedgerResponse = await request('/api/v1/ledger', { headers: { 'X-Request-Id': `qa-request-${runId}` } });
  const initialLedger = (await json(initialLedgerResponse, 200)).data;
  assert.equal(initialLedgerResponse.headers.get('x-request-id'), `qa-request-${runId}`);
  assert.equal(initialLedgerResponse.headers.get('cimbra-version'), '2026-08-28');
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
    body: JSON.stringify({ name: 'QA integration', scopes: ['ledger:read', 'customers:read', 'customers:write'], expiresInDays: 30 }),
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
  const cardKey = `qa-card-${runId}`;
  const cardPayload = { accountId: account.id, product: 'debit', format: 'virtual' };
  const card = (await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 201)).card;
  const cardReplay = await json(await request('/api/v1/cards', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cardKey }, body: JSON.stringify(cardPayload),
  }), 200);
  assert.equal(cardReplay.card.id, card.id);

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
  const captured = await json(await request(`/api/v1/holds/${highHold.id}/capture`, { method: 'POST' }), 200);
  assert.equal(captured.hold.status, 'captured');

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
  const released = await json(await request(`/api/v1/holds/${releasable.id}/release`, { method: 'POST' }), 200);
  assert.equal(released.hold.status, 'released');

  const insufficient = await json(await request('/api/v1/transfers', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `qa-insufficient-${runId}` },
    body: JSON.stringify({ counterparty: 'QA Supplier', description: 'Must fail', amount: '9000000', currency: 'ARS' }),
  }), 422);
  assert.equal(insufficient.error.code, 'insufficient_funds');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('file', new File([png], 'qa-evidence.png', { type: 'image/png' }));
  await json(await request('/api/v1/compliance/documents', { method: 'POST', body: form }), 201);

  const events = (await json(await request('/api/v1/events'), 200)).data;
  assert.ok(events.some((event) => event.action === 'transfer.reversed'));
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
    checks: ['auth', 'email-verification', 'password-recovery', 'session-revocation', 'totp-mfa', 'recovery-codes', 'tenant-seed', 'api-v1', 'request-id', 'rate-limit-headers', 'api-keys', 'scopes', 'revocation', 'webhook-security', 'webhook-rotation', 'customers-idempotency', 'accounts-idempotency', 'cards-idempotency', 'transfers-idempotency', 'holds', 'capture', 'release', 'reversal', 'insufficient-funds', 'private-evidence', 'audit'],
  }));
} finally {
  await cleanup();
  await sql.end();
}
