import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { createOrganizationWebhook, listOrganizationWebhooks, normalizeWebhookEventTypes } from '@/app/lib/platform/webhooks';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'webhooks:manage', roles: ['owner', 'admin'] });
    return NextResponse.json({ data: await listOrganizationWebhooks(principal.organizationId) }, { headers: { 'Cache-Control': 'no-store' } });
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
      const message = error instanceof Error ? error.message : 'No se pudo crear el webhook.';
      const conflict = /unique|duplicate/i.test(message);
      return NextResponse.json({ error: conflict ? 'Ya existe un webhook con esa URL.' : message }, { status: conflict ? 409 : 400 });
    }
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
