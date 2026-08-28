import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { rotateOrganizationWebhookSecret } from '@/app/lib/platform/webhooks';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', roles: ['owner', 'admin'], mutation: true });
    const { id } = await context.params;
    const result = await rotateOrganizationWebhookSecret(principal.organizationId, principal.user, id);
    if (!result) return NextResponse.json({ error: 'Webhook activo no encontrado.' }, { status: 404 });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
