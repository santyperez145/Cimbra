import { NextResponse } from 'next/server';
import { createOrganizationApiKey, listOrganizationApiKeys } from '@/app/lib/platform/api-keys';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { normalizeScopes } from '@/app/lib/platform/scopes';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'credentials.manage', sessionOnly: true });
    return NextResponse.json({ data: await listOrganizationApiKeys(principal.organizationId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { capability: 'credentials.manage', mutation: true, sessionOnly: true });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const scopes = normalizeScopes(body?.scopes);
    const expiresInDays = body?.expiresInDays === null || body?.expiresInDays === undefined ? null : Number(body.expiresInDays);
    if (name.length < 2 || !scopes || (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
      return NextResponse.json({ error: 'Nombre, scopes o vencimiento inválidos.' }, { status: 400 });
    }
    const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
    const result = await createOrganizationApiKey({ organizationId: principal.organizationId, actor: principal.user, name, scopes, expiresAt });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
