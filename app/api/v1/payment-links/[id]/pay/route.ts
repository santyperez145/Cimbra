import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizePaymentLinkPayInput } from '@/app/lib/platform/collections-input';
import { CollectionError, payPaymentLink } from '@/db/collections';

async function create(request: Request, linkId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'payments:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const payment = normalizePaymentLinkPayInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!payment || !rawSignals) return NextResponse.json({ error: 'Datos de cobro inválidos.', code: 'invalid_payment_link_pay' }, { status: 400 });
    if ('unsupportedMethod' in payment) {
      const code = payment.unsupportedMethod === 'card' ? 'card_acquiring_not_supported'
        : payment.unsupportedMethod === 'pos' || payment.unsupportedMethod === 'tap_to_phone' ? 'presentment_acquiring_not_supported'
          : 'interoperable_qr_not_supported';
      return NextResponse.json({
        error: 'El sandbox de cobranzas no procesa tarjetas, POS ni QR interoperable.',
        code,
      }, { status: 422 });
    }
    const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await payPaymentLink({
      organizationId: principal.organizationId, actor: principal.user, linkId, idempotencyKey, payment, signals,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if ('declined' in result) return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.',
      code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
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

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => create(request, (await params).id));
}
