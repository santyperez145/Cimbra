import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

const countries = new Set(['AR', 'MX', 'CO', 'BR', 'CL', 'PE']);

export async function POST(request: Request) {
  try {
  const principal = await authorizeApiRequest(request, { scope: 'customers:write', roles: ['owner', 'admin', 'operator'], mutation: true });
  const { user, organizationId } = principal;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const type = body?.type === undefined ? 'individual' : body.type;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 140) : '';
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  const taxId = typeof body?.taxId === 'string' ? body.taxId.replace(/\D/g, '').slice(-20) : '';
  if (!['individual', 'business'].includes(String(type)) || name.length < 2 || !countries.has(country) || taxId.length < 4) return NextResponse.json({ error: 'Datos de cliente inválidos.' }, { status: 400 });
    await ensureDatabase();
    const customer = { id: crypto.randomUUID(), type: String(type), name, country, taxIdLast4: taxId.slice(-4), status: 'active', createdAt: new Date().toISOString() };
    await getDatabase().transaction(async (transaction) => {
      await transaction.prepare(
        'INSERT INTO customers (id, organization_id, type, name, country, tax_id_last4, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(customer.id, organizationId, customer.type, customer.name, customer.country, customer.taxIdLast4, customer.status, customer.createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'customer.created', resourceType: 'customer', resourceId: customer.id, payload: { type, country } }, transaction);
    });
    scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, customer }, { status: 201 });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
