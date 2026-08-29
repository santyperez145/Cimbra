import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { CardIssuingError, listCardLifecycle, transitionCardStatus } from '@/db/card-issuing';

async function list(request: Request, cardId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', capability: 'console.read' });
    return NextResponse.json({ data: await listCardLifecycle(principal.organizationId, cardId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof CardIssuingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function transition(request: Request, cardId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:write', capability: 'finance.write', mutation: true });
    const result = await transitionCardStatus({
      organizationId: principal.organizationId,
      actor: principal.user,
      cardId,
      idempotencyKey: requestIdempotencyKey(request, principal)!,
      value: await request.json().catch(() => null),
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof CardIssuingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => list(request, (await params).id));
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => transition(request, (await params).id));
}
