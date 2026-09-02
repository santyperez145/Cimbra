import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeOrganizationPatch } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { getOrganizationProfile, OrganizationAdminError, updateOrganizationProfile } from '@/db/organization';

async function retrieve(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'organization:read', capability: 'organization.read' });
    return NextResponse.json({ data: await getOrganizationProfile(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof OrganizationAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

async function update(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'organization:write', capability: 'organization.manage', mutation: true });
    requestIdempotencyKey(request, principal);
    const input = normalizeOrganizationPatch(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'Datos de organización inválidos.', code: 'invalid_organization' }, { status: 400 });
    }
    const result = await updateOrganizationProfile({ organizationId: principal.organizationId, actor: principal.user, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof OrganizationAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => retrieve(request)); }
export function PATCH(request: Request) { return versionedApi(request, () => update(request)); }
