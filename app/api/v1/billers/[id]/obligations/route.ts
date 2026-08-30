import { NextResponse } from 'next/server';
import type { Currency } from '@/app/lib/ledger/money';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { normalizeObligationInput, normalizeProtectedReference } from '@/app/lib/platform/billers-input';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createBillerObligation, listBillerObligations, retrieveBiller } from '@/db/billers';

async function list(request: Request, billerId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'billers:read', capability: 'console.read' });
    const referenceValue = new URL(request.url).searchParams.get('subscriberReference');
    const subscriberReference = referenceValue === null ? null : normalizeProtectedReference(referenceValue);
    if (referenceValue !== null && !subscriberReference) return NextResponse.json({ error: 'Referencia de suscriptor inválida.', code: 'invalid_subscriber_reference' }, { status: 400 });
    if (!await retrieveBiller(principal.organizationId, billerId)) return NextResponse.json({ error: 'Biller no encontrado.', code: 'biller_not_found' }, { status: 404 });
    return NextResponse.json({ data: await listBillerObligations(principal.organizationId, billerId, subscriberReference) },
      { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

async function create(request: Request, billerId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'billers:write', capability: 'billers.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const biller = await retrieveBiller(principal.organizationId, billerId);
    if (!biller) return NextResponse.json({ error: 'Biller no encontrado.', code: 'biller_not_found' }, { status: 404 });
    const input = normalizeObligationInput(await request.json().catch(() => null), biller.currency as Currency);
    if (!input) return NextResponse.json({ error: 'Obligación inválida.', code: 'invalid_obligation' }, { status: 400 });
    const result = await createBillerObligation({ organizationId: principal.organizationId, actor: principal.user, billerId, idempotencyKey, ...input });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; return versionedApi(request, () => list(request, id)); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; return versionedApi(request, () => create(request, id)); }

