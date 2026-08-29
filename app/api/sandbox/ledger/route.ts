import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { getLedgerBalances, listActiveHolds, listLedgerJournals } from '@/db/ledger';

export async function GET(request: Request) {
  try {
  const principal = await authorizeApiRequest(request, { scope: 'ledger:read', capability: 'console.read' });
  const { organizationId } = principal;
  const [balances, journals, holds] = await Promise.all([
    getLedgerBalances(organizationId),
    listLedgerJournals(organizationId),
    listActiveHolds(organizationId),
  ]);
  return NextResponse.json({ data: { balances, journals, holds } }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
