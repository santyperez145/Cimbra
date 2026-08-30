import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { statementPeriod } from '@/app/lib/platform/book-transfers-input';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { BookTransferError, getAccountStatement } from '@/db/book-transfers';
import { ensureDatabase } from '@/db/runtime';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'accounts:read', capability: 'console.read' });
    const url = new URL(request.url); const period = statementPeriod(url);
    const limit = pageLimit(url.searchParams.get('limit'), 50, 100); const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (!period || limit === null || cursor === undefined) return NextResponse.json({ error: 'Período o paginación inválidos.', code: 'invalid_statement_query' }, { status: 400 });
    await ensureDatabase(); const { id } = await context.params;
    const statement = await getAccountStatement({ organizationId: principal.organizationId, accountId: id,
      ...period, limit, cursor: cursor ?? undefined });
    const page = paginatedResponse(statement.entries, limit);
    return NextResponse.json({ account: statement.account, period: statement.period, ...page }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response;
    if (error instanceof BookTransferError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
