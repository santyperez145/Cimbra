import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeCurrency } from '@/app/lib/ledger/money';
import { createProductLedgerAccount } from '@/db/ledger';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'accounts:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const { user, organizationId } = principal;
    const idempotencyKey = requestIdempotencyKey(request, principal);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
    const currency = normalizeCurrency(body?.currency);
    const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
    if (!customerId || !currency || !['AR', 'MX', 'CO', 'BR', 'CL', 'PE'].includes(country)) {
      return NextResponse.json({ error: 'Datos de cuenta inválidos.' }, { status: 400 });
    }
    await ensureDatabase();
    const db = getDatabase();
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ? AND organization_id = ? LIMIT 1').bind(customerId, organizationId).first();
    if (!customer) return NextResponse.json({ error: 'El cliente no pertenece a esta organización.' }, { status: 404 });
    const id = crypto.randomUUID();
    const accountReference = `${country}-${currency}-${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0').slice(-10)}`;
    const createdAt = new Date().toISOString();
    const createdAccount = { id, customerId, currency, country, accountReference, balance: 0, status: 'active', createdAt };
    const result = await db.transaction(async (transaction) => {
      if (idempotencyKey) {
        await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
          .bind(`${organizationId}:account:${idempotencyKey}`).run();
        const existing = await transaction.prepare(
          `SELECT id, customer_id AS "customerId", currency, country, account_reference AS "accountReference",
            0::int AS balance, status, created_at AS "createdAt"
           FROM accounts WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
        ).bind(organizationId, idempotencyKey).first<typeof createdAccount>();
        if (existing) {
          if (existing.customerId !== customerId || existing.currency !== currency || existing.country !== country) {
            throw new IdempotencyError('Idempotency-Key ya fue usado con otros datos de cuenta.', 409, 'idempotency_mismatch');
          }
          return { account: existing, replayed: true };
        }
      }
      const ledgerAccountId = await createProductLedgerAccount({
        organizationId, accountId: id, currency, name: `Cuenta ${accountReference}`,
      }, transaction);
      await transaction.prepare(
        `INSERT INTO accounts
          (id, organization_id, idempotency_key, customer_id, ledger_account_id, currency, country, account_reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, organizationId, idempotencyKey, customerId, ledgerAccountId, currency, country, accountReference, 'active', createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'account.created', resourceType: 'account', resourceId: id, payload: { currency, country } }, transaction);
      return { account: createdAccount, replayed: false };
    });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, account: result.account, replayed: result.replayed }, {
      status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal),
    });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof IdempotencyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
