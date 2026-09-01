import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveWalletProgram } from '@/db/wallets';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'wallets:read', capability: 'console.read' });
    const program = await retrieveWalletProgram(principal.organizationId, id);
    if (!program) {
      return NextResponse.json({ error: 'Programa de wallet no encontrado.', code: 'wallet_program_not_found' }, { status: 404 });
    }
    return NextResponse.json(program, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}
