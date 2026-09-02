import type { AuthUser } from '@/app/lib/auth/types';
import { ORGANIZATION_COUNTRIES } from '@/app/lib/platform/support-input.ts';
import { getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';

export class OrganizationAdminError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'organization_error') { super(message); }
}

export async function getOrganizationProfile(organizationId: string) {
  const row = await getDatabaseClient().prepare(
    `SELECT id, name, slug, country, status, created_at AS "createdAt",
      (SELECT COUNT(*)::int FROM members m WHERE m.organization_id = organizations.id) AS "memberCount"
     FROM organizations WHERE id = ? LIMIT 1`,
  ).bind(organizationId).first<{
    id: string; name: string; slug: string; country: string; status: string; createdAt: string; memberCount: number;
  }>();
  if (!row) throw new OrganizationAdminError('Organización no encontrada.', 404, 'organization_not_found');
  return row;
}

export async function updateOrganizationProfile(input: {
  organizationId: string; actor: AuthUser; name?: string; country?: typeof ORGANIZATION_COUNTRIES[number];
}) {
  const current = await getOrganizationProfile(input.organizationId);
  const name = input.name ?? current.name;
  const country = input.country ?? current.country;
  if (name === current.name && country === current.country) return { organization: current, replayed: true };
  await getDatabaseClient().prepare('UPDATE organizations SET name = ?, country = ? WHERE id = ?')
    .bind(name, country, input.organizationId).run();
  await getDatabaseClient().prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, 'organization.updated', 'organization', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actor.userId, input.organizationId,
    JSON.stringify({ name, country }), new Date().toISOString()).run();
  await enqueueWebhookEvent(getDatabaseClient(), {
    organizationId: input.organizationId, eventType: 'organization.updated', resourceType: 'organization',
    resourceId: input.organizationId, data: { name, country },
  });
  return { organization: await getOrganizationProfile(input.organizationId), replayed: false };
}

export async function listPlatformTenants() {
  const rows = await getDatabaseClient().prepare(
    `SELECT o.id, o.name, o.slug, o.country, o.status, o.created_at AS "createdAt",
      (SELECT COUNT(*)::int FROM members m WHERE m.organization_id = o.id) AS "memberCount",
      (SELECT COUNT(*)::int FROM support_cases c WHERE c.organization_id = o.id AND c.status IN ('open', 'pending_cimbra', 'pending_tenant')) AS "openSupportCases"
     FROM organizations o ORDER BY o.created_at DESC LIMIT 200`,
  ).all<{
    id: string; name: string; slug: string; country: string; status: string; createdAt: string;
    memberCount: number; openSupportCases: number;
  }>();
  return rows.results;
}

export async function listPlatformLeads() {
  const rows = await getDatabaseClient().prepare(
    `SELECT id, name, company, email, volume, message, status, created_at AS "createdAt"
     FROM leads ORDER BY created_at DESC LIMIT 200`,
  ).all<{
    id: string; name: string; company: string; email: string; volume: string; message: string; status: string; createdAt: string;
  }>();
  return rows.results;
}

export async function updatePlatformLead(id: string, status: string) {
  const current = await getDatabaseClient().prepare(
    'SELECT id, status FROM leads WHERE id = ? LIMIT 1',
  ).bind(id).first<{ id: string; status: string }>();
  if (!current) throw new OrganizationAdminError('Lead no encontrado.', 404, 'lead_not_found');
  if (current.status === status) return { id, status, replayed: true };
  await getDatabaseClient().prepare('UPDATE leads SET status = ? WHERE id = ?').bind(status, id).run();
  return { id, status, replayed: false };
}

export async function touchPlatformOperator(userId: string) {
  const now = new Date().toISOString();
  await getDatabaseClient().prepare(
    `INSERT INTO platform_operators (user_id, role, created_at, last_seen_at) VALUES (?, 'owner', ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
  ).bind(userId, now, now).run();
}
