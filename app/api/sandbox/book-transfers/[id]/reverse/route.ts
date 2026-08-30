import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { BookTransferError, reverseBookTransfer } from '@/db/book-transfers';
import { LedgerError } from '@/db/ledger';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal);
    if (!idempotencyKey) throw new IdempotencyError('Idempotency-Key es requerido.');
    const { id } = await context.params;
    const result = await reverseBookTransfer({ organizationId: principal.organizationId, actor: principal.user,
      transferId: id, idempotencyKey });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof BookTransferError || error instanceof LedgerError || error instanceof IdempotencyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
