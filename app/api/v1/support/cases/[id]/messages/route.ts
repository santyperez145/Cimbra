import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeSupportMessageInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { addSupportMessage, SupportError } from '@/db/support';

async function reply(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'support:write', capability: 'support.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeSupportMessageInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'El mensaje debe tener entre 3 y 4000 caracteres.', code: 'invalid_support_message' }, { status: 400 });
    }
    const result = await addSupportMessage({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey, id,
      body: input.body, authorKind: 'tenant',
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => reply(request, (await params).id));
}
