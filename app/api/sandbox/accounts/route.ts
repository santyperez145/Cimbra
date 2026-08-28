import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { normalizeCurrency } from '@/app/lib/ledger/money';
import { createProductLedgerAccount } from '@/db/ledger';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

export async function POST(request: Request) {
  try {
  const principal = await authorizeApiRequest(request, { scope: 'accounts:write', roles: ['owner', 'admin', 'operator'], mutation: true });
  const { user, organizationId } = principal;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
  const currency = normalizeCurrency(body?.currency);
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  if (!customerId || !currency || !['AR', 'MX', 'CO', 'BR', 'CL', 'PE'].includes(country)) return NextResponse.json({ error: 'Datos de cuenta inválidos.' }, { status: 400 });
    await ensureDatabase();
    const db = getDatabase();
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ? AND organization_id = ? LIMIT 1').bind(customerId, organizationId).first();
    if (!customer) return NextResponse.json({ error: 'El cliente no pertenece a esta organización.' }, { status: 404 });
    const id = crypto.randomUUID();
    const accountReference = `${country}-${currency}-${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0').slice(-10)}`;
    const createdAt = new Date().toISOString();
    await db.transaction(async (transaction) => {
      const ledgerAccountId = await createProductLedgerAccount({
        organizationId, accountId: id, currency, name: `Cuenta ${accountReference}`,
      }, transaction);
      await transaction.prepare(
        `INSERT INTO accounts
          (id, organization_id, customer_id, ledger_account_id, currency, country, account_reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, organizationId, customerId, ledgerAccountId, currency, country, accountReference, 'active', createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'account.created', resourceType: 'account', resourceId: id, payload: { currency, country } }, transaction);
    });
    scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, account: { id, customerId, currency, country, accountReference, balance: 0, status: 'active', createdAt } }, { status: 201 });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
