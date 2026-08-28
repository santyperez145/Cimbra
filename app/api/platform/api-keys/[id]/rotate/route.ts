import { NextResponse } from 'next/server';
import { rotateOrganizationApiKey } from '@/app/lib/platform/api-keys';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { roles: ['owner', 'admin'], mutation: true, sessionOnly: true });
    const { id } = await context.params;
    const result = await rotateOrganizationApiKey(principal.organizationId, principal.user, id);
    if (!result) return NextResponse.json({ error: 'API key activa no encontrada.' }, { status: 404 });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
