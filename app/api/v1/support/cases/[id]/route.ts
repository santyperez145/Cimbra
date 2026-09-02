import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeSupportStatusInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveSupportCase, SupportError, updateSupportStatus } from '@/db/support';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'support:read', capability: 'support.read' });
    return NextResponse.json({ data: await retrieveSupportCase(principal.organizationId, id) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

async function update(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'support:write', capability: 'support.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeSupportStatusInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'Estado de soporte inválido.', code: 'invalid_support_status' }, { status: 400 });
    }
    const result = await updateSupportStatus({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey, id, status: input.status,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => update(request, (await params).id));
}
