import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { isUnsupportedEcheq, normalizeEcheqEndorseInput } from '@/app/lib/platform/echeqs-input';
import { endorseEcheq, EcheqError } from '@/db/echeqs';
import { unsupportedEcheqResponse } from '../../route';

async function create(request: Request, echeqId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const endorse = normalizeEcheqEndorseInput(await request.json().catch(() => null));
    if (!endorse) return NextResponse.json({ error: 'Datos de endoso inválidos.', code: 'invalid_echeq_endorse' }, { status: 400 });
    if (isUnsupportedEcheq(endorse)) return unsupportedEcheqResponse(endorse.unsupportedFeature);
    const result = await endorseEcheq({
      organizationId: principal.organizationId, actor: principal.user, echeqId, idempotencyKey, endorse,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof EcheqError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => create(request, (await params).id));
}
