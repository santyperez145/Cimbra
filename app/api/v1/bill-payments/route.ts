import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { normalizeBillPaymentInput } from '@/app/lib/platform/billers-input';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createBillPaymentOrder, listBillPaymentOrders } from '@/db/billers';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:read', capability: 'console.read' });
    return NextResponse.json({ data: await listBillPaymentOrders(principal.organizationId) }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeBillPaymentInput(await request.json().catch(() => null));
    if (!input) return NextResponse.json({ error: 'Orden de pago inválida.', code: 'invalid_bill_payment' }, { status: 400 });
    const result = await createBillPaymentOrder({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }

