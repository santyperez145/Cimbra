import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { AccessControlError, revokeOrganizationInvitation } from '@/db/access';
import type { OrganizationRole } from '@/db/runtime';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { roles: ['owner', 'admin'], mutation: true, sessionOnly: true });
    const invitation = await revokeOrganizationInvitation({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as Extract<OrganizationRole, 'owner' | 'admin'>, invitationId: (await params).id });
    if (!invitation.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, invitation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof AccessControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
