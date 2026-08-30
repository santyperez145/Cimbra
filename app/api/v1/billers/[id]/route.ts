import { NextResponse } from 'next/server';
import { authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { billerApiErrorResponse } from '@/app/lib/platform/biller-api';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { retrieveBiller } from '@/db/billers';

async function retrieve(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'billers:read', capability: 'console.read' });
    const biller = await retrieveBiller(principal.organizationId, id);
    if (!biller) return NextResponse.json({ error: 'Biller no encontrado.', code: 'biller_not_found' }, { status: 404 });
    return NextResponse.json({ data: biller }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) { const response = billerApiErrorResponse(error); if (response) return response; throw error; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; return versionedApi(request, () => retrieve(request, id));
}

