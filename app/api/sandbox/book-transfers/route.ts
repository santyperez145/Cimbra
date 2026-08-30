import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { parseBookTransferInput } from '@/app/lib/platform/book-transfers-input';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { normalizeRawRiskSignals, protectRiskSignals } from '@/app/lib/platform/risk-signals';
import { ApprovalError, createBookTransferWithApprovalPolicy } from '@/db/approvals';
import { BookTransferError, listBookTransfers } from '@/db/book-transfers';
import { ensureDatabase, OrganizationAccessError } from '@/db/runtime';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const url = new URL(request.url); const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.', code: 'invalid_pagination' }, { status: 400 });
    await ensureDatabase();
    const rows = await listBookTransfers({ organizationId: principal.organizationId, limit, cursor: cursor ?? undefined });
    return NextResponse.json(paginatedResponse(rows, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof BookTransferError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal);
    if (!idempotencyKey) throw new IdempotencyError('Idempotency-Key es requerido.');
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const parsed = parseBookTransferInput(body); const rawSignals = normalizeRawRiskSignals(body?.signals);
    if (!parsed || !rawSignals) return NextResponse.json({ error: 'Datos de book transfer inválidos.', code: 'invalid_book_transfer' }, { status: 400 });
    await ensureDatabase(); const signals = await protectRiskSignals(principal.organizationId, rawSignals);
    const result = await createBookTransferWithApprovalPolicy({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey, ...parsed, signals, authentication: principal.authentication, apiKeyId: principal.apiKeyId });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    if (result.requiresApproval) return NextResponse.json({ ok: true, ...result }, {
      status: result.approval.status === 'executed' ? 200 : 202, headers: rateLimitHeaders(principal),
    });
    if ('declined' in result) return NextResponse.json({ error: 'La operación fue rechazada por la política de riesgo.',
      code: 'risk_declined', evaluation: result.declined }, { status: 422, headers: rateLimitHeaders(principal) });
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof BookTransferError || error instanceof ApprovalError || error instanceof IdempotencyError || error instanceof OrganizationAccessError) {
      return NextResponse.json({ error: error.message, code: error instanceof OrganizationAccessError ? 'forbidden' : error.code }, { status: error.status });
    }
    throw error;
  }
}
