import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { normalizeWalletInput } from '@/app/lib/platform/wallets-input';
import { WalletError, createWallet, listWallets } from '@/db/wallets';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:read', capability: 'console.read' });
    const url = new URL(request.url); const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.', code: 'invalid_pagination' }, { status: 400 });
    const rows = await listWallets({ organizationId: principal.organizationId, limit, cursor: cursor ?? undefined });
    return NextResponse.json(paginatedResponse(rows, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof WalletError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:write', capability: 'finance.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const wallet = normalizeWalletInput(await request.json().catch(() => null));
    if (!wallet) return NextResponse.json({ error: 'Datos de wallet inválidos.', code: 'invalid_wallet' }, { status: 400 });
    const result = await createWallet({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey, wallet });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, {
      status: result.replayed ? 200 : 201,
      headers: rateLimitHeaders(principal),
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof WalletError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
