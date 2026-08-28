import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest } from '@/app/lib/platform/authorization';
import { ensureDatabase, getDatabase } from '@/db/runtime';

export async function GET(request: Request) {
  try {
  const { organizationId } = await authorizeApiRequest(request, { scope: 'events:read', roles: ['owner', 'admin', 'operator', 'viewer'] });
  await ensureDatabase();
  const events = await getDatabase().prepare(
    `SELECT id, action, resource_type AS resourceType, resource_id AS resourceId, payload, created_at AS createdAt
     FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`,
  ).bind(organizationId).all<{
    id: string; action: string; resourceType: string; resourceId: string; payload: string; createdAt: string;
  }>();
  return NextResponse.json({
    data: events.results.map((event) => {
      try {
        return { ...event, payload: JSON.parse(event.payload) as unknown };
      } catch {
        return { ...event, payload: {} };
      }
    }),
  }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
