import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeAssignAliasInput } from '@/app/lib/platform/instant-payments-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { assignCollectionTillAlias, CollectionError } from '@/db/collections';

async function assign(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const parsed = normalizeAssignAliasInput(await request.json().catch(() => null));
    if (!parsed) return NextResponse.json({ error: 'Alias inválido.', code: 'invalid_alias' }, { status: 400 });
    const result = await assignCollectionTillAlias({
      organizationId: principal.organizationId, actor: principal.user, tillId: id, idempotencyKey, alias: parsed.alias,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 200, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof CollectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => assign(request, (await params).id));
}
