import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { ReconciliationError, resolveReconciliationException } from '@/db/reconciliation';

async function resolveException(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'reconciliation:write', capability: 'reconciliation.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const resolution = body?.resolution === 'corrected' || body?.resolution === 'accepted' ? body.resolution : null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!resolution || note.length < 3) return NextResponse.json({ error: 'Resolución de excepción inválida.', code: 'invalid_exception_resolution' }, { status: 400 });
    const result = await resolveReconciliationException({ organizationId: principal.organizationId, actor: principal.user,
      exceptionId: id, resolution, note, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, exception: result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof ReconciliationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => resolveException(request, (await params).id));
}
