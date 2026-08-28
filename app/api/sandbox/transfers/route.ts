import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { createTransfer, LedgerError } from '@/db/ledger';
import { ensureDatabase, OrganizationAccessError, requireOrganizationRole } from '@/db/runtime';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : '';
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
  const currency = normalizeCurrency(body?.currency ?? 'ARS');
  if (counterparty.length < 2 || description.length < 2 || !currency) {
    return NextResponse.json({ error: 'Datos de transferencia inválidos.' }, { status: 400 });
  }
  let amountMinor: bigint;
  try {
    amountMinor = majorToMinor(body?.amount, currency);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.' }, { status: 400 });
  }
  if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) {
    return NextResponse.json({ error: 'El monto debe ser mayor a cero y no superar 10.000.000 en unidades mayores.' }, { status: 400 });
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim().slice(0, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return NextResponse.json({ error: 'Idempotency-Key es requerido y debe tener al menos 8 caracteres.' }, { status: 400 });
  }
  try {
    await ensureDatabase();
    const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator']);
    const riskScore = amountMinor >= majorToMinor('2000000', currency) ? 68 : amountMinor >= majorToMinor('750000', currency) ? 32 : 7;
    const result = await createTransfer({
      organizationId, actor: user, idempotencyKey, counterparty, description, amountMinor, currency, riskScore,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof LedgerError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof LedgerError ? error.code : 'forbidden' }, { status: error.status });
    }
    throw error;
  }
}
