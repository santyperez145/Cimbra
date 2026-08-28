import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { replayWebhookDelivery } from '@/db/platform';
import { recordAuditEvent } from '@/db/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', roles: ['owner', 'admin'], mutation: true });
    const { id } = await context.params;
    if (!(await replayWebhookDelivery(principal.organizationId, id))) {
      return NextResponse.json({ error: 'Entrega no encontrada.' }, { status: 404 });
    }
    await recordAuditEvent({
      organizationId: principal.organizationId, actorId: principal.user.userId, action: 'webhook.delivery_replayed',
      resourceType: 'webhook_delivery', resourceId: id,
    });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
