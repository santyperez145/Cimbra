import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { LedgerError, reverseTransfer } from '@/db/ledger';
import { OrganizationAccessError } from '@/db/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
  const principal = await authorizeApiRequest(request, { scope: 'transfers:write', roles: ['owner', 'admin', 'operator'], mutation: true });
  const { user, organizationId } = principal;
  const idempotencyKey = request.headers.get('idempotency-key')?.trim().slice(0, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return NextResponse.json({ error: 'Idempotency-Key es requerido y debe tener al menos 8 caracteres.' }, { status: 400 });
  }
    const { id } = await context.params;
    const result = await reverseTransfer({ organizationId, actor: user, transactionId: id, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof LedgerError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof LedgerError ? error.code : 'forbidden' }, { status: error.status });
    }
    throw error;
  }
}
