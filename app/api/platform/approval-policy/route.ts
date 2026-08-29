import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { approvalActionType, approvalExpiryMinutes } from '@/app/lib/platform/approval-policy';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { ApprovalError, configureApprovalPolicy, getApprovalPolicies } from '@/db/approvals';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { roles: ['owner', 'admin', 'operator', 'viewer'], sessionOnly: true });
    const policies = await getApprovalPolicies(principal.organizationId);
    return NextResponse.json({ data: policies[0], policies,
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
    const actionType = approvalActionType(body?.actionType ?? 'settlement.execute');
    if (typeof body?.enabled !== 'boolean' || expiresInMinutes === null || !actionType) {
      return NextResponse.json({ error: 'Política de aprobación inválida.', code: 'invalid_approval_policy' }, { status: 400 });
    }
    const policy = await configureApprovalPolicy({ organizationId: principal.organizationId, actor: principal.user,
      actionType, enabled: body.enabled, expiresInMinutes });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, policy }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof ApprovalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
