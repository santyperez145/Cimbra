import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { normalizeDueDiligenceCaseInput } from '@/app/lib/platform/due-diligence-input';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createDueDiligenceCase, DueDiligenceError } from '@/db/due-diligence';

async function createCase(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'compliance:write', capability: 'compliance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeDueDiligenceCaseInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Expediente KYC/KYB inválido.', code: 'invalid_due_diligence_case' }, { status: 400 });
    const result = await createDueDiligenceCase({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey: `due-diligence-create:${idempotencyKey}`, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201,
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof DueDiligenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createCase(request)); }
