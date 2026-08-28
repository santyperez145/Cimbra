import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getDatabase, getOrCreateOrganization, recordAuditEvent } from '@/db/runtime';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
  const product = ['debit', 'credit', 'prepaid'].includes(String(body?.product)) ? String(body?.product) : 'debit';
  const format = ['virtual', 'physical'].includes(String(body?.format)) ? String(body?.format) : 'virtual';
  if (!accountId) return NextResponse.json({ error: 'accountId es requerido.' }, { status: 400 });
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const db = getDatabase();
  const account = await db.prepare('SELECT id, customer_id AS customerId FROM accounts WHERE id = ? AND organization_id = ? LIMIT 1').bind(accountId, organizationId).first<{ id: string; customerId: string }>();
  if (!account) return NextResponse.json({ error: 'La cuenta no pertenece a esta organización.' }, { status: 404 });
  const id = crypto.randomUUID();
  const last4 = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
  const createdAt = new Date().toISOString();
  await db.prepare(
    'INSERT INTO cards (id, organization_id, account_id, customer_id, product, format, last4, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, organizationId, accountId, account.customerId, product, format, last4, 'active', createdAt).run();
  await recordAuditEvent({ organizationId, actorId: user.userId, action: 'card.created', resourceType: 'card', resourceId: id, payload: { product, format } });
  return NextResponse.json({ ok: true, card: { id, accountId, customerId: account.customerId, product, format, last4, status: 'active', createdAt } }, { status: 201 });
}
