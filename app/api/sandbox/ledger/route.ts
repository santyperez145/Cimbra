import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { getLedgerBalances, listActiveHolds, listLedgerJournals } from '@/db/ledger';
import { requireOrganizationRole } from '@/db/runtime';

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator', 'viewer']);
  const [balances, journals, holds] = await Promise.all([
    getLedgerBalances(organizationId),
    listLedgerJournals(organizationId),
    listActiveHolds(organizationId),
  ]);
  return NextResponse.json({ data: { balances, journals, holds } }, { headers: { 'Cache-Control': 'no-store' } });
}
