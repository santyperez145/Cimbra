import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { canDecideApproval, type ApprovalActionType, type ApprovalStatus } from '@/app/lib/platform/approval-policy';
import type { OrganizationRole } from '@/app/lib/platform/access-policy';
import { type DatabaseClient, getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';
import { executeSettlementCycle, executeSettlementCycleInTransaction, SettlementError } from './settlements';

export class ApprovalError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'approval_error') { super(message); }
}

type ApprovalRow = {
  id: string; actionType: ApprovalActionType; resourceType: 'settlement_cycle'; resourceId: string;
  status: ApprovalStatus; requestFingerprint: string; requestPayload: string; requestedBy: string; requestedByName: string;
  resolvedBy: string | null; resolvedByName: string | null; resolutionReason: string | null;
  expiresAt: string; resolvedAt: string | null; executedAt: string | null; createdAt: string; updatedAt: string;
};

const approvalSelect = `SELECT ar.id, ar.action_type AS "actionType", ar.resource_type AS "resourceType", ar.resource_id AS "resourceId",
  ar.status, ar.request_fingerprint AS "requestFingerprint", ar.request_payload AS "requestPayload",
  ar.requested_by AS "requestedBy", requester.display_name AS "requestedByName",
  ar.resolved_by AS "resolvedBy", resolver.display_name AS "resolvedByName", ar.resolution_reason AS "resolutionReason",
  ar.expires_at AS "expiresAt", ar.resolved_at AS "resolvedAt", ar.executed_at AS "executedAt",
  ar.created_at AS "createdAt", ar.updated_at AS "updatedAt"
  FROM approval_requests ar JOIN users requester ON requester.id = ar.requested_by
  LEFT JOIN users resolver ON resolver.id = ar.resolved_by`;

function serializeApproval(row: ApprovalRow) {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.requestPayload) as Record<string, unknown>; } catch { payload = {}; }
  const { requestFingerprint, ...publicRow } = row; void requestFingerprint;
  return { ...publicRow, requestPayload: payload };
}

function approvalExecutionMode(row: ApprovalRow): 'manual' | 'scheduled' {
  try {
    return (JSON.parse(row.requestPayload) as { executionMode?: unknown }).executionMode === 'scheduled' ? 'scheduled' : 'manual';
  } catch { return 'manual'; }
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceType: 'approval_policy' | 'approval_request';
  resourceId: string; payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType, input.resourceId,
    JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

async function approvalById(database: DatabaseClient, organizationId: string, id: string) {
  const row = await database.prepare(`${approvalSelect} WHERE ar.organization_id = ? AND ar.id = ? LIMIT 1`)
    .bind(organizationId, id).first<ApprovalRow>();
  return row ? serializeApproval(row) : null;
}

async function approvalDecisionByIdempotencyKey(database: DatabaseClient, organizationId: string, idempotencyKey: string) {
  const event = await database.prepare(
    `SELECT resource_id AS "resourceId", action, payload FROM audit_events
     WHERE organization_id = ? AND resource_type = 'approval_request'
       AND action IN ('approval.request_executed', 'approval.request_rejected', 'approval.request_cancelled')
       AND payload::jsonb->>'idempotencyKey' = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(organizationId, idempotencyKey).first<{ resourceId: string; action: string; payload: string }>();
  if (!event) return null;
  let decision = ''; let reason = '';
  try {
    const payload = JSON.parse(event.payload) as { decision?: unknown; reason?: unknown };
    decision = String(payload.decision ?? ''); reason = typeof payload.reason === 'string' ? payload.reason : '';
  } catch { /* no legacy decision */ }
  return { resourceId: event.resourceId, decision, reason };
}

export async function getSettlementApprovalPolicy(organizationId: string) {
  const database = getDatabaseClient();
  const [policy, approvers] = await Promise.all([
    database.prepare(
      `SELECT id, enabled, expires_in_minutes AS "expiresInMinutes", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM approval_policies WHERE organization_id = ? AND action_type = 'settlement.execute' LIMIT 1`,
    ).bind(organizationId).first<{ id: string; enabled: number; expiresInMinutes: number; createdAt: string; updatedAt: string }>(),
    database.prepare(
      `SELECT COUNT(*)::int AS count FROM members m JOIN users u ON u.id = m.external_user_id
       WHERE m.organization_id = ? AND m.role IN ('owner', 'admin') AND u.mfa_enabled = 1`,
    ).bind(organizationId).first<{ count: number }>(),
  ]);
  return {
    id: policy?.id ?? null, actionType: 'settlement.execute' as const, enabled: policy?.enabled === 1,
    expiresInMinutes: policy?.expiresInMinutes ?? 1440, eligibleApprovers: approvers?.count ?? 0,
    createdAt: policy?.createdAt ?? null, updatedAt: policy?.updatedAt ?? null,
  };
}

export async function configureSettlementApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; enabled: boolean; expiresInMinutes: number;
}) {
  if (!input.actor.mfaEnabled) throw new ApprovalError('Activá MFA antes de administrar doble aprobación.', 403, 'approval_mfa_required');
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:settlement.execute`).first();
    const now = new Date().toISOString();
    if (input.enabled) {
      const checker = await database.prepare(
        `SELECT m.id FROM members m JOIN users u ON u.id = m.external_user_id
         WHERE m.organization_id = ? AND m.role IN ('owner', 'admin') AND u.mfa_enabled = 1 AND m.external_user_id <> ? LIMIT 1`,
      ).bind(input.organizationId, input.actor.userId).first<{ id: string }>();
      if (!checker) throw new ApprovalError('Necesitás otro owner o admin con MFA para habilitar doble aprobación.', 409, 'approval_checker_required');
    } else {
      const stale = await database.prepare(
        `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = 'settlement.execute'
         AND ar.status = 'pending' AND ar.expires_at <= ? FOR UPDATE OF ar`,
      ).bind(input.organizationId, now).all<ApprovalRow>();
      for (const row of stale.results) await expireApproval(database, input.organizationId, row, now);
      const pending = await database.prepare(
        `SELECT id FROM approval_requests WHERE organization_id = ? AND action_type = 'settlement.execute'
         AND status = 'pending' AND expires_at > ? LIMIT 1`,
      ).bind(input.organizationId, now).first<{ id: string }>();
      if (pending) throw new ApprovalError('Resolvé o cancelá las solicitudes pendientes antes de desactivar la política.', 409, 'pending_approvals_exist');
    }
    const id = crypto.randomUUID();
    const policy = await database.prepare(
      `INSERT INTO approval_policies (id, organization_id, action_type, enabled, expires_in_minutes, created_by, created_at, updated_at)
       VALUES (?, ?, 'settlement.execute', ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, action_type) DO UPDATE SET enabled = EXCLUDED.enabled,
         expires_in_minutes = EXCLUDED.expires_in_minutes, updated_at = EXCLUDED.updated_at
       RETURNING id, enabled, expires_in_minutes AS "expiresInMinutes", created_at AS "createdAt", updated_at AS "updatedAt"`,
    ).bind(id, input.organizationId, input.enabled ? 1 : 0, input.expiresInMinutes, input.actor.userId, now, now)
      .first<{ id: string; enabled: number; expiresInMinutes: number; createdAt: string; updatedAt: string }>();
    if (!policy) throw new ApprovalError('No pudimos guardar la política.', 500, 'approval_policy_update_failed');
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.policy_updated',
      resourceType: 'approval_policy', resourceId: policy.id, payload: { actionType: 'settlement.execute', enabled: input.enabled,
        expiresInMinutes: input.expiresInMinutes } });
    return { ...policy, actionType: 'settlement.execute' as const, enabled: policy.enabled === 1 };
  });
}

export async function requiresSettlementApproval(organizationId: string, database = getDatabaseClient()) {
  const policy = await database.prepare(
    `SELECT enabled FROM approval_policies WHERE organization_id = ? AND action_type = 'settlement.execute' LIMIT 1`,
  ).bind(organizationId).first<{ enabled: number }>();
  return policy?.enabled === 1;
}

async function expireApproval(database: DatabaseClient, organizationId: string, row: ApprovalRow, now: string) {
  await database.prepare(
    `UPDATE approval_requests SET status = 'expired', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
  ).bind(now, now, row.id).run();
  await audit(database, { organizationId, actorId: row.requestedBy, action: 'approval.request_expired',
    resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId } });
}

export async function listApprovalRequests(organizationId: string) {
  return getDatabaseClient().transaction(async (database) => {
    const now = new Date().toISOString();
    const stale = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.status = 'pending' AND ar.expires_at <= ? FOR UPDATE OF ar`,
    ).bind(organizationId, now).all<ApprovalRow>();
    for (const row of stale.results) await expireApproval(database, organizationId, row, now);
    const rows = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? ORDER BY ar.created_at DESC LIMIT 100`,
    ).bind(organizationId).all<ApprovalRow>();
    return rows.results.map(serializeApproval);
  });
}

export async function retrieveApprovalRequest(organizationId: string, id: string) {
  return getDatabaseClient().transaction(async (database) => {
    const row = await database.prepare(`${approvalSelect} WHERE ar.organization_id = ? AND ar.id = ? FOR UPDATE OF ar`)
      .bind(organizationId, id).first<ApprovalRow>();
    if (!row) return null;
    const now = new Date().toISOString();
    if (row.status === 'pending' && row.expiresAt <= now) {
      await expireApproval(database, organizationId, row, now);
      return approvalById(database, organizationId, id);
    }
    return serializeApproval(row);
  });
}

export async function requestSettlementExecutionApproval(input: {
  organizationId: string; actorId: string; cycleId: string; idempotencyKey: string; executionMode: 'manual' | 'scheduled';
}) {
  const fingerprint = await sha256(JSON.stringify({ actionType: 'settlement.execute', cycleId: input.cycleId, executionMode: input.executionMode }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:settlement.execute:${input.cycleId}`).first();
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:settlement.execute`).first();
    const existingKey = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingKey) {
      if (existingKey.requestFingerprint !== fingerprint) throw new ApprovalError('La Idempotency-Key ya fue usada para otra aprobación.', 409, 'idempotency_mismatch');
      return { approval: serializeApproval(existingKey), replayed: true, deduplicated: false };
    }
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'settlement.execute' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) throw new ApprovalError('La política de doble aprobación no está activa.', 409, 'approval_not_required');
    const cycle = await database.prepare(
      `SELECT id, name, rail, currency, net_minor::text AS "netMinor", difference_minor::text AS "differenceMinor",
        status, scheduled_for AS "scheduledFor" FROM settlement_cycles WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.cycleId, input.organizationId).first<{
      id: string; name: string; rail: string; currency: string; netMinor: string; differenceMinor: string; status: string; scheduledFor: string | null;
    }>();
    if (!cycle) throw new SettlementError('Ciclo de settlement no encontrado.', 404, 'settlement_cycle_not_found');
    if (cycle.status === 'settled') throw new SettlementError('El ciclo ya fue ejecutado.', 409, 'settlement_cycle_already_executed');
    const now = new Date().toISOString();
    if (cycle.scheduledFor && cycle.scheduledFor > now) throw new SettlementError('El ciclo todavía no alcanzó su horario programado.', 409, 'settlement_not_due');
    const stale = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = 'settlement.execute' AND ar.resource_id = ?
       AND ar.status = 'pending' AND ar.expires_at <= ? FOR UPDATE OF ar`,
    ).bind(input.organizationId, cycle.id, now).all<ApprovalRow>();
    for (const row of stale.results) await expireApproval(database, input.organizationId, row, now);
    const pending = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = 'settlement.execute' AND ar.resource_id = ?
       AND ar.status = 'pending' AND ar.expires_at > ? ORDER BY ar.created_at DESC LIMIT 1`,
    ).bind(input.organizationId, cycle.id, now).first<ApprovalRow>();
    if (pending) return { approval: serializeApproval(pending), replayed: true, deduplicated: true };
    const id = crypto.randomUUID(); const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = { name: cycle.name, rail: cycle.rail, currency: cycle.currency, netMinor: cycle.netMinor,
      differenceMinor: cycle.differenceMinor, scheduledFor: cycle.scheduledFor, executionMode: input.executionMode, sandbox: true };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'settlement.execute', 'settlement_cycle', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, cycle.id, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actorId, expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actorId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'settlement.execute', resourceType: 'settlement_cycle',
        resourceId: cycle.id, expiresAt, ...payload } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { approval, replayed: false, deduplicated: false };
  });
}

export async function decideApprovalRequest(input: {
  organizationId: string; actor: AuthUser; actorRole: OrganizationRole; requestId: string;
  decision: 'approve' | 'reject'; reason: string; idempotencyKey: string;
}) {
  if (!input.actor.mfaEnabled) throw new ApprovalError('Activá MFA antes de aprobar operaciones sensibles.', 403, 'approval_mfa_required');
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-decision:${input.idempotencyKey}`).first();
    const priorDecision = await approvalDecisionByIdempotencyKey(database, input.organizationId, input.idempotencyKey);
    if (priorDecision) {
      if (priorDecision.resourceId !== input.requestId || priorDecision.decision !== input.decision || priorDecision.reason !== input.reason) {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra decisión.', 409, 'idempotency_mismatch');
      }
      return { approval: await approvalById(database, input.organizationId, input.requestId), replayed: true, expired: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-request:${input.requestId}`).first();
    const row = await database.prepare(`${approvalSelect} WHERE ar.organization_id = ? AND ar.id = ? FOR UPDATE OF ar`)
      .bind(input.organizationId, input.requestId).first<ApprovalRow>();
    if (!row) throw new ApprovalError('Solicitud no encontrada.', 404, 'approval_not_found');
    if (row.status !== 'pending') throw new ApprovalError('La solicitud ya no está pendiente.', 409, 'approval_not_pending');
    const now = new Date().toISOString();
    if (row.expiresAt <= now) {
      await expireApproval(database, input.organizationId, row, now);
      return { approval: await approvalById(database, input.organizationId, row.id), replayed: false, expired: true };
    }
    if (!canDecideApproval({ actorRole: input.actorRole, actorId: input.actor.userId, requesterId: row.requestedBy,
      mfaEnabled: input.actor.mfaEnabled })) {
      if (row.requestedBy === input.actor.userId) throw new ApprovalError('El maker no puede aprobar su propia solicitud.', 409, 'approval_self_decision');
      throw new ApprovalError('Se requiere un owner o admin con MFA para decidir.', 403, 'approval_checker_required');
    }
    let executedCycle: Awaited<ReturnType<typeof executeSettlementCycleInTransaction>>['cycle'] | undefined;
    if (input.decision === 'reject') {
      await database.prepare(
        `UPDATE approval_requests SET status = 'rejected', resolved_by = ?, resolution_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.actor.userId, input.reason, now, now, row.id).run();
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_rejected',
        resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
          reason: input.reason, decision: input.decision, idempotencyKey: input.idempotencyKey } });
    } else {
      const execution = await executeSettlementCycleInTransaction(database, { organizationId: input.organizationId, actorId: input.actor.userId,
        cycleId: row.resourceId, idempotencyKey: `approval:${row.id}`, executionMode: approvalExecutionMode(row), approvalAuthorized: true });
      executedCycle = execution.cycle;
      await database.prepare(
        `UPDATE approval_requests SET status = 'executed', resolved_by = ?, resolution_reason = ?, resolved_at = ?, executed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.actor.userId, input.reason || null, now, now, now, row.id).run();
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_executed',
        resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
          requesterId: row.requestedBy, reason: input.reason || null, decision: input.decision, idempotencyKey: input.idempotencyKey } });
    }
    const approval = await approvalById(database, input.organizationId, row.id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la decisión.', 500, 'approval_decision_failed');
    return { approval, cycle: executedCycle, replayed: false, expired: false };
  });
}

export async function cancelApprovalRequest(input: {
  organizationId: string; actorId: string; requestId: string; reason: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-decision:${input.idempotencyKey}`).first();
    const priorDecision = await approvalDecisionByIdempotencyKey(database, input.organizationId, input.idempotencyKey);
    if (priorDecision) {
      if (priorDecision.resourceId !== input.requestId || priorDecision.decision !== 'cancel' || priorDecision.reason !== input.reason) {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra decisión.', 409, 'idempotency_mismatch');
      }
      return { approval: await approvalById(database, input.organizationId, input.requestId), replayed: true, expired: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-request:${input.requestId}`).first();
    const row = await database.prepare(`${approvalSelect} WHERE ar.organization_id = ? AND ar.id = ? FOR UPDATE OF ar`)
      .bind(input.organizationId, input.requestId).first<ApprovalRow>();
    if (!row) throw new ApprovalError('Solicitud no encontrada.', 404, 'approval_not_found');
    if (row.status !== 'pending') throw new ApprovalError('La solicitud ya no está pendiente.', 409, 'approval_not_pending');
    if (row.requestedBy !== input.actorId) throw new ApprovalError('Sólo el maker puede cancelar esta solicitud.', 403, 'approval_cancel_forbidden');
    const now = new Date().toISOString();
    if (row.expiresAt <= now) {
      await expireApproval(database, input.organizationId, row, now);
      return { approval: await approvalById(database, input.organizationId, row.id), replayed: false, expired: true };
    }
    await database.prepare(
      `UPDATE approval_requests SET status = 'cancelled', resolved_by = ?, resolution_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(input.actorId, input.reason || null, now, now, row.id).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actorId, action: 'approval.request_cancelled',
      resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
        reason: input.reason || null, decision: 'cancel', idempotencyKey: input.idempotencyKey } });
    return { approval: await approvalById(database, input.organizationId, row.id), replayed: false, expired: false };
  });
}

export async function processDueSettlementCycles(limit = 25) {
  const database = getDatabaseClient();
  const due = await database.prepare(
    `SELECT id, organization_id AS "organizationId", created_by AS "createdBy" FROM settlement_cycles
     WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for, id LIMIT ?`,
  ).bind(new Date().toISOString(), limit).all<{ id: string; organizationId: string; createdBy: string }>();
  const results: Array<{ id: string; status: 'settled' | 'approval_pending' | 'failed'; approvalId?: string; error?: string }> = [];
  for (const cycle of due.results) {
    try {
      if (await requiresSettlementApproval(cycle.organizationId, database)) {
        const result = await requestSettlementExecutionApproval({ organizationId: cycle.organizationId, actorId: cycle.createdBy,
          cycleId: cycle.id, idempotencyKey: `scheduled:${cycle.id}:${crypto.randomUUID()}`, executionMode: 'scheduled' });
        results.push({ id: cycle.id, status: 'approval_pending', approvalId: result.approval.id });
      } else {
        await executeSettlementCycle({ organizationId: cycle.organizationId, actorId: cycle.createdBy, cycleId: cycle.id,
          idempotencyKey: `scheduled:${cycle.id}`, executionMode: 'scheduled' }, database);
        results.push({ id: cycle.id, status: 'settled' });
      }
    } catch (error) { results.push({ id: cycle.id, status: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }); }
  }
  return results;
}
