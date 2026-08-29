import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { normalizeCardControlsInput } from '@/app/lib/platform/card-issuing';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { CardIssuingError, getLatestCardControls, replaceCardControls } from '@/db/card-issuing';

async function retrieve(request: Request, cardId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', capability: 'console.read' });
    const controls = await getLatestCardControls(principal.organizationId, cardId);
    return NextResponse.json({ controls }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof CardIssuingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function replace(request: Request, cardId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:write', capability: 'finance.write', mutation: true });
    const controls = normalizeCardControlsInput(await request.json().catch(() => null));
    if (!controls) {
      return NextResponse.json({ error: 'Controles de tarjeta inválidos.', code: 'invalid_card_controls' }, { status: 400 });
    }
    const result = await replaceCardControls({
      organizationId: principal.organizationId,
      actor: principal.user,
      cardId,
      idempotencyKey: requestIdempotencyKey(request, principal)!,
      controls,
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
  return versionedApi(request, async () => retrieve(request, (await params).id));
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => replace(request, (await params).id));
}
