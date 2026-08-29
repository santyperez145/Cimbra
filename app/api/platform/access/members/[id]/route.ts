import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { AccessControlError, assignableRole, removeOrganizationMember, updateOrganizationMember } from '@/db/access';
import type { OrganizationRole } from '@/db/runtime';

const roles = ['owner', 'admin'] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { roles, mutation: true, sessionOnly: true });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const role = assignableRole(body?.role);
    if (!role) return NextResponse.json({ error: 'Rol inválido.', code: 'invalid_member_role' }, { status: 400 });
    const member = await updateOrganizationMember({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as Extract<OrganizationRole, 'owner' | 'admin'>, memberId: (await params).id, role });
    if (!member.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, member }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof AccessControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { roles, mutation: true, sessionOnly: true });
    const result = await removeOrganizationMember({ organizationId: principal.organizationId, actor: principal.user,
      actorRole: principal.role as Extract<OrganizationRole, 'owner' | 'admin'>, memberId: (await params).id });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof AccessControlError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
