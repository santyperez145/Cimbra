import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { ApprovalError, createTransferWithApprovalPolicy } from '@/db/approvals';
import { LedgerError, serializeTransaction } from '@/db/ledger';
import { ensureDatabase, getDatabase, OrganizationAccessError } from '@/db/runtime';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', roles: ['owner', 'admin', 'operator', 'viewer'] });
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.' }, { status: 400 });
    await ensureDatabase();
    const query = `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
      risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
      FROM transactions WHERE organization_id = ? ${cursor ? 'AND (created_at, id) < (?, ?)' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`;
    const statement = getDatabase().prepare(query);
    const rows = cursor
      ? await statement.bind(principal.organizationId, cursor.createdAt, cursor.id, limit + 1).all<Parameters<typeof serializeTransaction>[0]>()
      : await statement.bind(principal.organizationId, limit + 1).all<Parameters<typeof serializeTransaction>[0]>();
    return NextResponse.json(paginatedResponse(rows.results.map(serializeTransaction), limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const { user, organizationId } = principal;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 180) : '';
    const currency = normalizeCurrency(body?.currency ?? 'ARS');
    if (counterparty.length < 2 || description.length < 2 || !currency) {
      return NextResponse.json({ error: 'Datos de transferencia inválidos.' }, { status: 400 });
    }
    let amountMinor: bigint;
    try {
      amountMinor = majorToMinor(body?.amount, currency);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Monto inválido.' }, { status: 400 });
    }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', currency)) {
      return NextResponse.json({ error: 'El monto debe ser mayor a cero y no superar 10.000.000 en unidades mayores.' }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim().slice(0, 100);
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return NextResponse.json({ error: 'Idempotency-Key es requerido y debe tener al menos 8 caracteres.' }, { status: 400 });
    }
    await ensureDatabase();
    const result = await createTransferWithApprovalPolicy({
      organizationId, actor: user, idempotencyKey, counterparty, description, amountMinor, currency,
      authentication: principal.authentication, apiKeyId: principal.apiKeyId,
    });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    if (result.requiresApproval) {
      if (result.approval.status === 'failed') return NextResponse.json({ error: 'La ejecución aprobada falló.', code: 'approval_execution_failed' },
        { status: 422, headers: rateLimitHeaders(principal) });
      if (['rejected', 'cancelled', 'expired'].includes(result.approval.status)) return NextResponse.json(
        { error: `La solicitud está ${result.approval.status}.`, code: 'approval_not_pending' }, { status: 409, headers: rateLimitHeaders(principal) });
      return NextResponse.json({ ok: true, ...result }, { status: result.approval.status === 'executed' ? 200 : 202,
        headers: rateLimitHeaders(principal) });
    }
    if ('declined' in result) return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.', code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof LedgerError || error instanceof ApprovalError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof OrganizationAccessError ? 'forbidden' : error.code }, { status: error.status });
    }
    throw error;
  }
}
