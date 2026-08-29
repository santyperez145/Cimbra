import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveApprovalRequest } from '@/db/approvals';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'approvals:read' });
    const approval = await retrieveApprovalRequest(principal.organizationId, id);
    if (!approval) return NextResponse.json({ error: 'Solicitud no encontrada.', code: 'approval_not_found' }, { status: 404 });
    return NextResponse.json(approval, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
