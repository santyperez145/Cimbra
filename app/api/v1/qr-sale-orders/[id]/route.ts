import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { InstantPaymentError, cancelQrSaleOrder, retrieveQrSaleOrder } from '@/db/instant-payments';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const order = await retrieveQrSaleOrder(principal.organizationId, id);
    if (!order) return NextResponse.json({ error: 'Orden de venta no encontrada.', code: 'sale_order_not_found' }, { status: 404 });
    return NextResponse.json(order, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof InstantPaymentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function cancel(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const result = await cancelQrSaleOrder({
      organizationId: principal.organizationId, actor: principal.user, orderId: id, idempotencyKey,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 200, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof InstantPaymentError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}

export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => cancel(request, (await params).id));
}
