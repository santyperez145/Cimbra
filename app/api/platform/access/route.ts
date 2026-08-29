import { NextResponse } from 'next/server';
import { publicOrigin } from '@/app/lib/auth/config';
import { sendAuthMail } from '@/app/lib/auth/mailer';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { AccessControlError, assignableRole, inviteOrganizationMember, listOrganizationAccess, normalizeAccessEmail } from '@/db/access';
import type { OrganizationRole } from '@/db/runtime';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'organization.manage', sessionOnly: true });
    return NextResponse.json({ data: await listOrganizationAccess(principal.organizationId), current: {
      userId: principal.user.userId, role: principal.role,
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'organization.manage', mutation: true, sessionOnly: true });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = normalizeAccessEmail(body?.email); const role = assignableRole(body?.role);
    if (!email || !role) return NextResponse.json({ error: 'Email o rol inválido.', code: 'invalid_invitation' }, { status: 400 });
    const invitation = await inviteOrganizationMember({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as Extract<OrganizationRole, 'owner' | 'admin'>, email, role });
    let emailSent = false;
    try {
      emailSent = await sendAuthMail({
        to: email, subject: 'Te invitaron a operar en Cimbra', heading: 'Tu acceso a Cimbra está listo',
        message: `${principal.user.displayName} te invitó con el rol ${role}. Ingresá con este email verificado para aceptar el acceso automáticamente.`,
        actionLabel: 'Ingresar a Cimbra', actionUrl: new URL('/login?return_to=%2Fconsole', publicOrigin(request)).toString(),
        idempotencyKey: `organization-invitation-${invitation.id}-${invitation.updatedAt}`,
      });
    } catch (error) { console.error('Invitation email delivery failed', error instanceof Error ? error.message : String(error)); }
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, invitation, emailSent }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof AccessControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
