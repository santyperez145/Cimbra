import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { ensureDatabase, getDatabase } from '@/db/runtime';

export async function GET(request: Request) {
  try {
  const principal = await authorizeApiRequest(request, { scope: 'events:read', capability: 'console.read' });
  const { organizationId } = principal;
  const url = new URL(request.url);
  const limit = pageLimit(url.searchParams.get('limit'));
  const cursor = decodePageCursor(url.searchParams.get('cursor'));
  if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.' }, { status: 400 });
  await ensureDatabase();
  const query =
    `SELECT id, action, resource_type AS resourceType, resource_id AS resourceId, payload, created_at AS createdAt
     FROM audit_events WHERE organization_id = ? ${cursor ? 'AND (created_at, id) < (?, ?)' : ''}
     ORDER BY created_at DESC, id DESC LIMIT ?`;
  const statement = getDatabase().prepare(query);
  const events = cursor ? await statement.bind(organizationId, cursor.createdAt, cursor.id, limit + 1).all<{
    id: string; action: string; resourceType: string; resourceId: string; payload: string; createdAt: string;
  }>() : await statement.bind(organizationId, limit + 1).all<{
    id: string; action: string; resourceType: string; resourceId: string; payload: string; createdAt: string;
  }>();
  return NextResponse.json(paginatedResponse(events.results.map((event) => {
      try {
        return { ...event, payload: JSON.parse(event.payload) as unknown };
      } catch {
        return { ...event, payload: {} };
      }
    }), limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
