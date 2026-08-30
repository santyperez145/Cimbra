import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { retrieveBookTransfer } from '@/db/book-transfers';
import { ensureDatabase } from '@/db/runtime';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'transfers:read', capability: 'console.read' });
    await ensureDatabase(); const { id } = await context.params;
    const transfer = await retrieveBookTransfer(principal.organizationId, id);
    if (!transfer) return NextResponse.json({ error: 'Book transfer no encontrado.', code: 'book_transfer_not_found' }, { status: 404 });
    return NextResponse.json(transfer, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}
