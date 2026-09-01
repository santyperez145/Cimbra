import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { WalletError, listWalletPockets } from '@/db/wallets';

async function list(request: Request, walletId: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:read', capability: 'console.read' });
    return NextResponse.json({ data: await listWalletPockets(principal.organizationId, walletId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof WalletError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => list(request, (await params).id));
}
