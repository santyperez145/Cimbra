import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';
import { ensureDatabase, getDatabase, getOrCreateOrganization } from '@/db/runtime';

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  await ensureDatabase();
  const organizationId = await getOrCreateOrganization(user);
  const events = await getDatabase().prepare(
    `SELECT id, action, resource_type AS resourceType, resource_id AS resourceId, payload, created_at AS createdAt
     FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`,
  ).bind(organizationId).all();
  return NextResponse.json({ data: events.results });
}
