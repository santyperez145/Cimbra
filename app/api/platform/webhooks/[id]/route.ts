import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { disableOrganizationWebhook } from '@/app/lib/platform/webhooks';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', capability: 'credentials.manage', mutation: true });
    const { id } = await context.params;
    if (!(await disableOrganizationWebhook(principal.organizationId, principal.user, id))) {
      return NextResponse.json({ error: 'Webhook activo no encontrado.' }, { status: 404 });
    }
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
