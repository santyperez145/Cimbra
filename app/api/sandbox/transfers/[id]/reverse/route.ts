import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { LedgerError, reverseTransfer } from '@/db/ledger';
import { OrganizationAccessError, requireOrganizationRole } from '@/db/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const idempotencyKey = request.headers.get('idempotency-key')?.trim().slice(0, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return NextResponse.json({ error: 'Idempotency-Key es requerido y debe tener al menos 8 caracteres.' }, { status: 400 });
  }
  try {
    const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator']);
    const { id } = await context.params;
    const result = await reverseTransfer({ organizationId, actor: user, transactionId: id, idempotencyKey });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof LedgerError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof LedgerError ? error.code : 'forbidden' }, { status: error.status });
    }
    throw error;
  }
}
