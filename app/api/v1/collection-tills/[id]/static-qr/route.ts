import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizeCollectionTillStaticQrInput } from '@/app/lib/platform/collections-input';
import { CollectionError, issueCollectionTillStaticQr } from '@/db/collections';

async function issue(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const parsed = normalizeCollectionTillStaticQrInput(await request.json().catch(() => null));
    if (!parsed) return NextResponse.json({ error: 'Datos de QR estático inválidos.', code: 'invalid_collection_till_qr' }, { status: 400 });
    const result = await issueCollectionTillStaticQr({
      organizationId: principal.organizationId, actor: principal.user, tillId: id, idempotencyKey,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof CollectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => issue(request, (await params).id));
}
