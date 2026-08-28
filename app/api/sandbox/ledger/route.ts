import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { getLedgerBalances, listActiveHolds, listLedgerJournals } from '@/db/ledger';

export async function GET(request: Request) {
  try {
  const { organizationId } = await authorizeApiRequest(request, { scope: 'ledger:read', roles: ['owner', 'admin', 'operator', 'viewer'] });
  const [balances, journals, holds] = await Promise.all([
    getLedgerBalances(organizationId),
    listLedgerJournals(organizationId),
    listActiveHolds(organizationId),
  ]);
  return NextResponse.json({ data: { balances, journals, holds } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
