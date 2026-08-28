import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { executeSettlementCycle, SettlementError } from '@/db/settlements';

async function execute(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'settlements:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const result = await executeSettlementCycle({ organizationId: principal.organizationId, actorId: principal.user.userId,
      cycleId: id, idempotencyKey, executionMode: 'manual' });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof SettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => execute(request, (await params).id));
}
