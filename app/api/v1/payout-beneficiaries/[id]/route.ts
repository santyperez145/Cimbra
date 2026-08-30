import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { payoutApiErrorResponse } from '@/app/lib/platform/payout-api';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrievePayoutBeneficiary } from '@/db/payouts';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payouts:read', capability: 'console.read' });
    const beneficiary = await retrievePayoutBeneficiary(principal.organizationId, id);
    if (!beneficiary) return NextResponse.json({ error: 'Beneficiario no encontrado.', code: 'payout_beneficiary_not_found' },
      { status: 404, headers: rateLimitHeaders(principal) });
    return NextResponse.json(beneficiary, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = payoutApiErrorResponse(error); if (response) return response; throw error; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => retrieve(request, id));
}
