import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizePaymentLinkInput } from '@/app/lib/platform/collections-input';
import { CollectionError, createPaymentLink, listPaymentLinks } from '@/db/collections';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:read', capability: 'console.read' });
    const url = new URL(request.url); const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.', code: 'invalid_pagination' }, { status: 400 });
    const rows = await listPaymentLinks({ organizationId: principal.organizationId, limit, cursor: cursor ?? undefined });
    return NextResponse.json(paginatedResponse(rows, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof CollectionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const parsed = normalizePaymentLinkInput(await request.json().catch(() => null));
    if (!parsed) return NextResponse.json({ error: 'Datos de link de cobro inválidos.', code: 'invalid_payment_link' }, { status: 400 });
    if ('unsupportedMethod' in parsed) {
      const code = parsed.unsupportedMethod === 'card' ? 'card_acquiring_not_supported'
        : parsed.unsupportedMethod === 'pos' || parsed.unsupportedMethod === 'tap_to_phone' ? 'presentment_acquiring_not_supported'
          : 'interoperable_qr_not_supported';
      return NextResponse.json({
        error: 'El sandbox de cobranzas no procesa tarjetas, POS ni QR interoperable. Usá internal o sandbox_inbound.',
        code,
      }, { status: 422 });
    }
    const result = await createPaymentLink({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, link: parsed });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof CollectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
