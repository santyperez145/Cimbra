import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { approvalExpiryMinutes } from '@/app/lib/platform/approval-policy';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { ApprovalError, configureSettlementApprovalPolicy, getSettlementApprovalPolicy } from '@/db/approvals';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { roles: ['owner', 'admin'], sessionOnly: true });
    return NextResponse.json({ data: await getSettlementApprovalPolicy(principal.organizationId),
      current: { userId: principal.user.userId, role: principal.role, mfaEnabled: principal.user.mfaEnabled } },
    { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

export async function PATCH(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { roles: ['owner'], mutation: true, sessionOnly: true });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const expiresInMinutes = approvalExpiryMinutes(body?.expiresInMinutes);
    if (typeof body?.enabled !== 'boolean' || expiresInMinutes === null) {
      return NextResponse.json({ error: 'Política de aprobación inválida.', code: 'invalid_approval_policy' }, { status: 400 });
    }
    const policy = await configureSettlementApprovalPolicy({ organizationId: principal.organizationId, actor: principal.user,
      enabled: body.enabled, expiresInMinutes });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, policy }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
