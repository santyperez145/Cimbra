import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { normalizeCardProgramInput } from '@/app/lib/platform/card-issuing';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { CardIssuingError, createCardProgram, listCardPrograms } from '@/db/card-issuing';

async function listPrograms(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', capability: 'console.read' });
    return NextResponse.json({ data: await listCardPrograms(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

async function createProgram(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, {
      scope: 'cards:write', capability: 'cards.program.manage', mutation: true,
    });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const program = normalizeCardProgramInput(await request.json().catch(() => null));
    if (!program) {
      return NextResponse.json({ error: 'Programa de tarjetas inválido.', code: 'invalid_card_program' }, { status: 400 });
    }
    const result = await createCardProgram({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, program });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, {
      status: result.replayed ? 200 : 201,
      headers: rateLimitHeaders(principal),
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof CardIssuingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listPrograms(request)); }
export function POST(request: Request) { return versionedApi(request, () => createProgram(request)); }
