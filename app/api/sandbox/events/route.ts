import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { ensureDatabase, getDatabase, requireOrganizationRole } from '@/db/runtime';

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  await ensureDatabase();
  const { organizationId } = await requireOrganizationRole(user, ['owner', 'admin', 'operator', 'viewer']);
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
}
