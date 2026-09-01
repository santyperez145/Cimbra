import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { isUnsupportedEcheq, normalizeEcheqInput, type UnsupportedEcheqFeature } from '@/app/lib/platform/echeqs-input';
import { EcheqError, issueEcheq, listEcheqs } from '@/db/echeqs';

export function unsupportedEcheqResponse(feature: UnsupportedEcheqFeature) {
  const code = feature === 'discount' ? 'echeq_discount_not_supported'
    : feature === 'custody' ? 'echeq_custody_not_supported'
      : feature === 'usd' ? 'echeq_fx_not_supported'
        : 'coelsa_clearing_not_supported';
  return NextResponse.json({
    error: 'El sandbox de ECHEQ no descuenta, no toma custodia, no opera en USD ni compensa por Coelsa. Depositá en una cuenta Cimbra del tenant.',
    code,
  }, { status: 422 });
}

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    const url = new URL(request.url); const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.', code: 'invalid_pagination' }, { status: 400 });
    const rows = await listEcheqs({ organizationId: principal.organizationId, limit, cursor: cursor ?? undefined });
    return NextResponse.json(paginatedResponse(rows, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof EcheqError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const parsed = normalizeEcheqInput(await request.json().catch(() => null));
    if (!parsed) return NextResponse.json({ error: 'Datos de ECHEQ inválidos.', code: 'invalid_echeq' }, { status: 400 });
    if (isUnsupportedEcheq(parsed)) return unsupportedEcheqResponse(parsed.unsupportedFeature);
    const result = await issueEcheq({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, echeq: parsed });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof EcheqError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
