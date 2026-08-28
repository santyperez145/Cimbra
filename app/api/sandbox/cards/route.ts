import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent, requireOrganizationRole } from '@/db/runtime';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
  const product = body?.product === undefined ? 'debit' : String(body.product);
  const format = body?.format === undefined ? 'virtual' : String(body.format);
  if (!accountId || !['debit', 'credit', 'prepaid'].includes(product) || !['virtual', 'physical'].includes(format)) {
    return NextResponse.json({ error: 'Datos de tarjeta inválidos.' }, { status: 400 });
  }
  try {
    await ensureDatabase();
    const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator']);
    const db = getDatabase();
    const account = await db.prepare('SELECT id, customer_id AS customerId FROM accounts WHERE id = ? AND organization_id = ? LIMIT 1').bind(accountId, organizationId).first<{ id: string; customerId: string }>();
    if (!account) return NextResponse.json({ error: 'La cuenta no pertenece a esta organización.' }, { status: 404 });
    const id = crypto.randomUUID();
    const last4 = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
    const createdAt = new Date().toISOString();
    await db.transaction(async (transaction) => {
      await transaction.prepare(
        'INSERT INTO cards (id, organization_id, account_id, customer_id, product, format, last4, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, organizationId, accountId, account.customerId, product, format, last4, 'active', createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'card.created', resourceType: 'card', resourceId: id, payload: { product, format } }, transaction);
    });
    return NextResponse.json({ ok: true, card: { id, accountId, customerId: account.customerId, product, format, last4, status: 'active', createdAt } }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
