import type { AuthUser } from '@/app/lib/auth/types';
import { canManageRole, normalizeAccessEmail, type AssignableRole, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { type DatabaseClient, getDatabaseClient } from './client';
import { createSandboxOrganizationInTransaction } from './organization';
import { enqueueWebhookEvent } from './platform';
import { clearOpenReconciliationAssignments } from './reconciliation';
import { clearOpenRiskCaseAssignments } from './risk';

export { assignableRole, normalizeAccessEmail } from '@/app/lib/platform/access-policy';

export class AccessControlError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'access_control_error') { super(message); }
}

type MemberRow = {
  id: string; userId: string; email: string; displayName: string; role: OrganizationRole;
  emailVerified: number; mfaEnabled: number; createdAt: string;
};

type InvitationRow = {
  id: string; email: string; role: AssignableRole; status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string; invitedByName: string; acceptedBy: string | null; expiresAt: string;
  acceptedAt: string | null; createdAt: string; updatedAt: string;
};

function serializeMember(row: MemberRow) {
  return { ...row, emailVerified: row.emailVerified === 1, mfaEnabled: row.mfaEnabled === 1 };
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceType: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const createdAt = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType, input.resourceId,
    JSON.stringify(input.payload ?? {}), createdAt).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

function assertCanManage(actorRole: 'owner' | 'admin', targetRole: OrganizationRole, nextRole?: AssignableRole) {
  if (targetRole === 'owner') throw new AccessControlError('El owner no puede modificarse desde esta operación.', 409, 'owner_is_protected');
  if (!canManageRole(actorRole, targetRole, nextRole)) throw new AccessControlError('Un admin no puede administrar otros admins.', 403, 'admin_hierarchy_violation');
}

export async function ensureOrganizationMembership(user: AuthUser) {
  const email = normalizeAccessEmail(user.email);
  if (!email) throw new AccessControlError('La cuenta no tiene un email válido.', 400, 'invalid_member_email');
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`membership-email:${email}`).first();
    const existing = await database.prepare(
      `SELECT organization_id AS "organizationId", role FROM members WHERE external_user_id = ? LIMIT 1`,
    ).bind(user.userId).first<{ organizationId: string; role: OrganizationRole }>();
    if (existing) return existing;
    const now = new Date().toISOString();
    await database.prepare(
      `UPDATE organization_invitations SET status = 'expired', updated_at = ?
       WHERE email = ? AND status = 'pending' AND expires_at <= ?`,
    ).bind(now, email, now).run();
    const invitation = await database.prepare(
      `SELECT id, organization_id AS "organizationId", role FROM organization_invitations
       WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at LIMIT 1 FOR UPDATE`,
    ).bind(email, now).first<{ id: string; organizationId: string; role: AssignableRole }>();
    if (invitation) {
      if (!user.emailVerified) {
        throw new AccessControlError('Verificá este email antes de aceptar la invitación.', 403, 'invitation_email_verification_required');
      }
      await database.prepare(
        `INSERT INTO members (id, organization_id, external_user_id, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), invitation.organizationId, user.userId, email, invitation.role, now).run();
      await database.prepare(
        `UPDATE organization_invitations SET status = 'accepted', accepted_by = ?, accepted_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(user.userId, now, now, invitation.id).run();
      await audit(database, { organizationId: invitation.organizationId, actorId: user.userId,
        action: 'organization.invitation_accepted', resourceType: 'organization_invitation', resourceId: invitation.id,
        payload: { email, role: invitation.role } });
      return { organizationId: invitation.organizationId, role: invitation.role as OrganizationRole };
    }
    const organizationId = crypto.randomUUID();
    const safeBase = email.split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'workspace';
    await createSandboxOrganizationInTransaction(database, {
      id: organizationId,
      name: 'Cimbra Sandbox',
      slug: `${safeBase}-${organizationId.slice(0, 6)}`,
      country: 'AR',
      createdAt: now,
    });
    await database.prepare(
      'INSERT INTO members (id, organization_id, external_user_id, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), organizationId, user.userId, email, 'owner', now).run();
    return { organizationId, role: 'owner' as const };
  });
}

export async function listOrganizationAccess(organizationId: string) {
  const database = getDatabaseClient();
  const now = new Date().toISOString();
  await database.prepare(
    `UPDATE organization_invitations SET status = 'expired', updated_at = ?
     WHERE organization_id = ? AND status = 'pending' AND expires_at <= ?`,
  ).bind(now, organizationId, now).run();
  const [members, invitations] = await Promise.all([
    database.prepare(
      `SELECT m.id, m.external_user_id AS "userId", m.email, u.display_name AS "displayName", m.role,
        u.email_verified AS "emailVerified", u.mfa_enabled AS "mfaEnabled", m.created_at AS "createdAt"
       FROM members m JOIN users u ON u.id = m.external_user_id
       WHERE m.organization_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END, m.created_at`,
    ).bind(organizationId).all<MemberRow>(),
    database.prepare(
      `SELECT i.id, i.email, i.role, i.status, i.invited_by AS "invitedBy", u.display_name AS "invitedByName",
        i.accepted_by AS "acceptedBy", i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt",
        i.created_at AS "createdAt", i.updated_at AS "updatedAt"
       FROM organization_invitations i JOIN users u ON u.id = i.invited_by
       WHERE i.organization_id = ? ORDER BY i.created_at DESC LIMIT 100`,
    ).bind(organizationId).all<InvitationRow>(),
  ]);
  return { members: members.results.map(serializeMember), invitations: invitations.results };
}

export async function inviteOrganizationMember(input: {
  organizationId: string; actor: AuthUser; actorRole: 'owner' | 'admin'; email: string; role: AssignableRole;
}) {
  if (input.actorRole === 'admin' && input.role === 'admin') {
    throw new AccessControlError('Un admin no puede invitar otros admins.', 403, 'admin_hierarchy_violation');
  }
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`membership-email:${input.email}`).first();
    const membership = await database.prepare(
      `SELECT m.organization_id AS "organizationId" FROM members m JOIN users u ON u.id = m.external_user_id
       WHERE u.email = ? LIMIT 1`,
    ).bind(input.email).first<{ organizationId: string }>();
    if (membership?.organizationId === input.organizationId) {
      throw new AccessControlError('La persona ya pertenece a la organización.', 409, 'member_already_exists');
    }
    if (membership) throw new AccessControlError('La cuenta ya pertenece a otra organización.', 409, 'member_belongs_elsewhere');
    const pendingElsewhere = await database.prepare(
      `SELECT organization_id AS "organizationId" FROM organization_invitations
       WHERE email = ? AND status = 'pending' AND expires_at > ? AND organization_id <> ? LIMIT 1`,
    ).bind(input.email, new Date().toISOString(), input.organizationId).first<{ organizationId: string }>();
    if (pendingElsewhere) throw new AccessControlError('El email ya tiene otra invitación activa.', 409, 'invitation_already_pending');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();
    const invitation = await database.prepare(
      `INSERT INTO organization_invitations
        (id, organization_id, email, role, status, invited_by, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT (organization_id, email) DO UPDATE SET role = EXCLUDED.role, status = 'pending', invited_by = EXCLUDED.invited_by,
         accepted_by = NULL, accepted_at = NULL, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
       RETURNING id, email, role, status, invited_by AS "invitedBy", expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
    ).bind(id, input.organizationId, input.email, input.role, input.actor.userId, expiresAt, now, now).first<{
      id: string; email: string; role: AssignableRole; status: 'pending'; invitedBy: string; expiresAt: string; createdAt: string; updatedAt: string;
    }>();
    if (!invitation) throw new AccessControlError('No pudimos crear la invitación.', 500, 'invitation_create_failed');
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'organization.invitation_created', resourceType: 'organization_invitation', resourceId: invitation.id,
      payload: { email: input.email, role: input.role, expiresAt } });
    return invitation;
  });
}

export async function updateOrganizationMember(input: {
  organizationId: string; actor: AuthUser; actorRole: 'owner' | 'admin'; memberId: string; role: AssignableRole;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const current = await database.prepare(
      `SELECT id, external_user_id AS "userId", email, role FROM members WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.memberId, input.organizationId).first<{ id: string; userId: string; email: string; role: OrganizationRole }>();
    if (!current) throw new AccessControlError('Miembro no encontrado.', 404, 'member_not_found');
    if (current.userId === input.actor.userId) throw new AccessControlError('No podés cambiar tu propio rol.', 409, 'self_role_change');
    assertCanManage(input.actorRole, current.role, input.role);
    if (current.role === input.role) return { id: current.id, email: current.email, role: current.role, replayed: true };
    const now = new Date().toISOString();
    let unassignedWorkItems = 0;
    if (input.role === 'viewer') {
      unassignedWorkItems = (
        await clearOpenRiskCaseAssignments(input.organizationId, current.userId, now, database)
      ) + (
        await clearOpenReconciliationAssignments(input.organizationId, current.userId, now, database)
      );
    }
    await database.prepare('UPDATE members SET role = ? WHERE id = ?').bind(input.role, current.id).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'organization.member_role_updated', resourceType: 'organization_member', resourceId: current.id,
      payload: { email: current.email, previousRole: current.role, role: input.role, updatedAt: now, unassignedWorkItems } });
    return { id: current.id, email: current.email, role: input.role, replayed: false };
  });
}

export async function removeOrganizationMember(input: {
  organizationId: string; actor: AuthUser; actorRole: 'owner' | 'admin'; memberId: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const current = await database.prepare(
      `SELECT id, external_user_id AS "userId", email, role FROM members WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.memberId, input.organizationId).first<{ id: string; userId: string; email: string; role: OrganizationRole }>();
    if (!current) throw new AccessControlError('Miembro no encontrado.', 404, 'member_not_found');
    if (current.userId === input.actor.userId) throw new AccessControlError('No podés quitar tu propio acceso.', 409, 'self_removal');
    assertCanManage(input.actorRole, current.role);
    const now = new Date().toISOString();
    const unassignedWorkItems = (
      await clearOpenRiskCaseAssignments(input.organizationId, current.userId, now, database)
    ) + (
      await clearOpenReconciliationAssignments(input.organizationId, current.userId, now, database)
    );
    await database.prepare('DELETE FROM members WHERE id = ?').bind(current.id).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'organization.member_removed', resourceType: 'organization_member', resourceId: current.id,
      payload: { email: current.email, role: current.role, unassignedWorkItems } });
    return { id: current.id, removed: true };
  });
}

export async function revokeOrganizationInvitation(input: {
  organizationId: string; actor: AuthUser; actorRole: 'owner' | 'admin'; invitationId: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const invitation = await database.prepare(
      `SELECT id, email, role, status FROM organization_invitations WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.invitationId, input.organizationId).first<{ id: string; email: string; role: AssignableRole; status: string }>();
    if (!invitation) throw new AccessControlError('Invitación no encontrada.', 404, 'invitation_not_found');
    if (input.actorRole === 'admin' && invitation.role === 'admin') {
      throw new AccessControlError('Un admin no puede revocar invitaciones de admin.', 403, 'admin_hierarchy_violation');
    }
    if (invitation.status === 'revoked') return { id: invitation.id, status: 'revoked' as const, replayed: true };
    if (invitation.status !== 'pending') throw new AccessControlError('La invitación ya no está pendiente.', 409, 'invitation_not_pending');
    const now = new Date().toISOString();
    await database.prepare(`UPDATE organization_invitations SET status = 'revoked', updated_at = ? WHERE id = ?`).bind(now, invitation.id).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'organization.invitation_revoked', resourceType: 'organization_invitation', resourceId: invitation.id,
      payload: { email: invitation.email, role: invitation.role } });
    return { id: invitation.id, status: 'revoked' as const, replayed: false };
  });
}
