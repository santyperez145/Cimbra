import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getDatabase, getOrCreateOrganization, recordAuditEvent } from '@/db/runtime';

const currencies = new Set(['ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN']);

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
  const currency = typeof body?.currency === 'string' ? body.currency.toUpperCase() : '';
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  if (!customerId || !currencies.has(currency) || !['AR', 'MX', 'CO', 'BR', 'CL', 'PE'].includes(country)) return NextResponse.json({ error: 'Datos de cuenta inválidos.' }, { status: 400 });
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const db = getDatabase();
  const customer = await db.prepare('SELECT id FROM customers WHERE id = ? AND organization_id = ? LIMIT 1').bind(customerId, organizationId).first();
  if (!customer) return NextResponse.json({ error: 'El cliente no pertenece a esta organización.' }, { status: 404 });
  const id = crypto.randomUUID();
  const accountReference = `${country}-${currency}-${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0').slice(-10)}`;
  const createdAt = new Date().toISOString();
  await db.prepare(
    'INSERT INTO accounts (id, organization_id, customer_id, currency, country, account_reference, balance, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, organizationId, customerId, currency, country, accountReference, 0, 'active', createdAt).run();
  await recordAuditEvent({ organizationId, actorId: user.userId, action: 'account.created', resourceType: 'account', resourceId: id, payload: { currency, country } });
  return NextResponse.json({ ok: true, account: { id, customerId, currency, country, accountReference, balance: 0, status: 'active', createdAt } }, { status: 201 });
}
