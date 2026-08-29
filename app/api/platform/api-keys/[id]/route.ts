import { NextResponse } from 'next/server';
import { revokeOrganizationApiKey } from '@/app/lib/platform/api-keys';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'credentials.manage', mutation: true, sessionOnly: true });
    const { id } = await context.params;
    if (!(await revokeOrganizationApiKey(principal.organizationId, principal.user, id))) {
      return NextResponse.json({ error: 'API key activa no encontrada.' }, { status: 404 });
    }
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
