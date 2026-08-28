import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { LedgerError, resolveHold } from '@/db/ledger';
import { OrganizationAccessError } from '@/db/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const { user, organizationId } = principal;
    const idempotencyKey = requestIdempotencyKey(request, principal);
    const { id } = await context.params;
    const hold = await resolveHold({ organizationId, actor: user, holdId: id, action: 'capture', idempotencyKey: idempotencyKey! });
    if (!hold.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, hold }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof IdempotencyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof LedgerError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof LedgerError ? error.code : 'forbidden' }, { status: error.status });
    }
    throw error;
  }
}
