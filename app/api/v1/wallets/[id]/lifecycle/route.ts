import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { WalletError, listWalletLifecycle, transitionWalletStatus } from '@/db/wallets';

async function list(request: Request, walletId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:read', capability: 'console.read' });
    return NextResponse.json({ data: await listWalletLifecycle(principal.organizationId, walletId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof WalletError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

async function transition(request: Request, walletId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:write', capability: 'finance.write', mutation: true });
    const result = await transitionWalletStatus({
      organizationId: principal.organizationId, actor: principal.user, walletId,
      idempotencyKey: requestIdempotencyKey(request, principal)!,
      value: await request.json().catch(() => null),
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof WalletError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => list(request, (await params).id));
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => transition(request, (await params).id));
}
