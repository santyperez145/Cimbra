import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveWallet, listWalletPockets } from '@/db/wallets';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:read', capability: 'console.read' });
    const wallet = await retrieveWallet(principal.organizationId, id);
    if (!wallet) return NextResponse.json({ error: 'Wallet no encontrada.', code: 'wallet_not_found' }, { status: 404 });
    const pockets = await listWalletPockets(principal.organizationId, id);
    return NextResponse.json({ ...wallet, pockets }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
