import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ensureDatabase, getD1, getOrCreateOrganization, recordAuditEvent } from '@/db/runtime';

const currencies = new Set(['ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN']);

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : '';
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
  const amount = Number(body?.amount);
  const currency = typeof body?.currency === 'string' ? body.currency.toUpperCase() : 'ARS';
  if (counterparty.length < 2 || description.length < 2 || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || !currencies.has(currency)) {
    return NextResponse.json({ error: 'Datos de transferencia inválidos.' }, { status: 400 });
  }
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const db = getD1();
  const idempotencyKey = request.headers.get('idempotency-key')?.slice(0, 100) || crypto.randomUUID();
  const existing = await db.prepare(
    'SELECT id, status FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(organizationId, idempotencyKey).first<{ id: string; status: string }>();
  if (existing) return NextResponse.json({ ok: true, transaction: existing, replayed: true });
  const id = crypto.randomUUID();
  const riskScore = amount >= 2_000_000 ? 68 : amount >= 750_000 ? 32 : 7;
  const status = riskScore >= 60 ? 'review' : 'settled';
  await db.prepare(
    `INSERT INTO transactions
      (id, organization_id, idempotency_key, type, counterparty, description, amount, currency, status, risk_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, organizationId, idempotencyKey, 'debit', counterparty, description, -amount, currency, status, riskScore, new Date().toISOString()).run();
  await recordAuditEvent({ organizationId, actorId: user.userId, action: 'transfer.created', resourceType: 'transaction', resourceId: id, payload: { amount, currency, status } });
  return NextResponse.json({ ok: true, transaction: { id, status, riskScore } }, { status: 201 });
}
