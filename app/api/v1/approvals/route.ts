import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listApprovalRequests } from '@/db/approvals';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'approvals:read', capability: 'approvals.read' });
    return NextResponse.json({ data: await listApprovalRequests(principal.organizationId), meta: {
      currentUserId: principal.user.userId, role: principal.role, mfaEnabled: principal.user.mfaEnabled,
    } }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
