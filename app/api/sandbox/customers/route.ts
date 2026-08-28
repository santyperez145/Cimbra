import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getD1, getOrCreateOrganization, recordAuditEvent } from '@/db/runtime';

const countries = new Set(['AR', 'MX', 'CO', 'BR', 'CL', 'PE']);

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const type = body?.type === 'business' ? 'business' : 'individual';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 140) : '';
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  const taxId = typeof body?.taxId === 'string' ? body.taxId.replace(/\D/g, '').slice(-20) : '';
  if (name.length < 2 || !countries.has(country) || taxId.length < 4) return NextResponse.json({ error: 'Datos de cliente inválidos.' }, { status: 400 });
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const customer = { id: crypto.randomUUID(), type, name, country, taxIdLast4: taxId.slice(-4), status: 'active', createdAt: new Date().toISOString() };
  await getD1().prepare(
    'INSERT INTO customers (id, organization_id, type, name, country, tax_id_last4, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(customer.id, organizationId, customer.type, customer.name, customer.country, customer.taxIdLast4, customer.status, customer.createdAt).run();
  await recordAuditEvent({ organizationId, actorId: user.userId, action: 'customer.created', resourceType: 'customer', resourceId: customer.id, payload: { type, country } });
  return NextResponse.json({ ok: true, customer }, { status: 201 });
}
