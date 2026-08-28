import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { LedgerError, resolveHold } from '@/db/ledger';
import { OrganizationAccessError, requireOrganizationRole } from '@/db/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  try {
    const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator']);
    const { id } = await context.params;
    const hold = await resolveHold({ organizationId, actor: user, holdId: id, action: 'release' });
    return NextResponse.json({ ok: true, hold });
  } catch (error) {
    if (error instanceof LedgerError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof LedgerError ? error.code : 'forbidden' }, { status: error.status });
    }
    throw error;
  }
}
