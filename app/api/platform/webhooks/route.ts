import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { createOrganizationWebhook, listOrganizationWebhooks, normalizeWebhookEventTypes } from '@/app/lib/platform/webhooks';
import { WebhookDestinationError } from '@/app/lib/platform/webhook-url';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', roles: ['owner', 'admin'] });
    return NextResponse.json({ data: await listOrganizationWebhooks(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', roles: ['owner', 'admin'], mutation: true });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const eventTypes = normalizeWebhookEventTypes(body?.eventTypes);
    if (name.length < 2 || !eventTypes || typeof body?.url !== 'string') {
      return NextResponse.json({ error: 'Nombre, URL o eventos inválidos.' }, { status: 400 });
    }
    let result;
    try {
      result = await createOrganizationWebhook({ organizationId: principal.organizationId, actor: principal.user, name, url: body.url, eventTypes });
    } catch (error) {
      if (error instanceof WebhookDestinationError) return NextResponse.json({ error: error.message }, { status: 400 });
      const message = error instanceof Error ? error.message : '';
      const conflict = /unique|duplicate/i.test(message);
      if (conflict) return NextResponse.json({ error: 'Ya existe un webhook con esa URL.' }, { status: 409 });
      throw error;
    }
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, {
      status: 201, headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
