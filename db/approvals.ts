import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { canDecideApproval, type ApprovalActionType, type ApprovalStatus } from '@/app/lib/platform/approval-policy';
import type { OrganizationRole } from '@/app/lib/platform/access-policy';
import type { Currency } from '@/app/lib/ledger/money';
import type { DisputeEvent, DisputeStatus } from '@/app/lib/platform/disputes';
import { parseProtectedRiskSignals, publicRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import { createTransferInTransaction, findPaymentByIdempotency, findTransferByIdempotency, LedgerError, resolveHold, createAccountPaymentInTransaction, reverseAccountPaymentInTransaction, reverseTransactionInTransaction, serializeTransaction, type AccountPaymentInput, type TransferCreationInput } from './ledger';
import { enqueueWebhookEvent } from './platform';
import { ReconciliationError, resolveReconciliationException } from './reconciliation';
import { getRiskCaseForResolution, resolveRiskCase, RiskError } from './risk';
import { executeSettlementCycle, executeSettlementCycleInTransaction, SettlementError } from './settlements';
import { DisputeError, transitionDispute } from './disputes';
import { authorizePayoutBatchInTransaction, closePayoutBatchApprovalInTransaction, PayoutError } from './payouts';
import { bookTransferFingerprint, BookTransferError, createBookTransferInTransaction, findBookTransferByIdempotency,
  retrieveBookTransfer, reverseBookTransferInTransaction, type BookTransferInput } from './book-transfers';

export class ApprovalError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'approval_error') { super(message); }
}

type ApprovalRow = {
  id: string; actionType: ApprovalActionType;
  resourceType: 'settlement_cycle' | 'transfer' | 'book_transfer' | 'payment' | 'payout_batch' | 'risk_case' | 'reconciliation_exception' | 'dispute'; resourceId: string;
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

function publicApprovalPayload(payload: Record<string, unknown>) {
  if (!('signals' in payload)) return payload;
  const signals = parseProtectedRiskSignals(payload.signals);
  const publicPayload = { ...payload };
  delete publicPayload.signals;
  return { ...publicPayload, signals: publicRiskSignals(signals ?? {}) };
}

function serializeApproval(row: ApprovalRow) {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.requestPayload) as Record<string, unknown>; } catch { payload = {}; }
  const { requestFingerprint, ...publicRow } = row; void requestFingerprint;
  return { ...publicRow, requestPayload: publicApprovalPayload(payload) };
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
       AND action IN ('approval.request_executed', 'approval.request_rejected', 'approval.request_cancelled', 'approval.request_failed')
       AND payload::jsonb->>'idempotencyKey' = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(organizationId, idempotencyKey).first<{ resourceId: string; action: string; payload: string }>();
  if (!event) return null;
  let decision = ''; let reason = ''; let failure: { message: string; code: string; status: number } | undefined;
  try {
    const payload = JSON.parse(event.payload) as { decision?: unknown; reason?: unknown; failure?: unknown };
    decision = String(payload.decision ?? ''); reason = typeof payload.reason === 'string' ? payload.reason : '';
    const stored = payload.failure as { message?: unknown; code?: unknown; status?: unknown } | undefined;
    if (stored && typeof stored.message === 'string' && typeof stored.code === 'string' && typeof stored.status === 'number') {
      failure = { message: stored.message, code: stored.code, status: stored.status };
    }
  } catch { /* no legacy decision */ }
  return { resourceId: event.resourceId, decision, reason, failure };
}

export async function getApprovalPolicies(organizationId: string) {
  const database = getDatabaseClient();
  const [policies, approvers] = await Promise.all([
    database.prepare(
      `SELECT id, action_type AS "actionType", enabled, expires_in_minutes AS "expiresInMinutes",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM approval_policies WHERE organization_id = ?`,
    ).bind(organizationId).all<{ id: string; actionType: ApprovalActionType; enabled: number; expiresInMinutes: number; createdAt: string; updatedAt: string }>(),
    database.prepare(
      `SELECT COUNT(*)::int AS count FROM members m JOIN users u ON u.id = m.external_user_id
       WHERE m.organization_id = ? AND m.role IN ('owner', 'admin') AND u.mfa_enabled = 1`,
    ).bind(organizationId).first<{ count: number }>(),
  ]);
  return (['settlement.execute', 'transfer.create', 'transfer.reverse', 'payment.create', 'payment.reverse', 'payout_batch.execute', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve'] as const).map((actionType) => {
    const policy = policies.results.find((item) => item.actionType === actionType);
    return { id: policy?.id ?? null, actionType, enabled: policy?.enabled === 1,
      expiresInMinutes: policy?.expiresInMinutes ?? 1440, eligibleApprovers: approvers?.count ?? 0,
      createdAt: policy?.createdAt ?? null, updatedAt: policy?.updatedAt ?? null };
  });
}

export async function configureApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; actionType: ApprovalActionType; enabled: boolean; expiresInMinutes: number;
}) {
  if (!input.actor.mfaEnabled) throw new ApprovalError('Activá MFA antes de administrar doble aprobación.', 403, 'approval_mfa_required');
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:${input.actionType}`).first();
    const now = new Date().toISOString();
    if (input.enabled) {
      const checker = await database.prepare(
        `SELECT m.id FROM members m JOIN users u ON u.id = m.external_user_id
         WHERE m.organization_id = ? AND m.role IN ('owner', 'admin') AND u.mfa_enabled = 1 AND m.external_user_id <> ? LIMIT 1`,
      ).bind(input.organizationId, input.actor.userId).first<{ id: string }>();
      if (!checker) throw new ApprovalError('Necesitás otro owner o admin con MFA para habilitar doble aprobación.', 409, 'approval_checker_required');
    } else {
      const stale = await database.prepare(
        `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = ?
         AND ar.status = 'pending' AND ar.expires_at <= ? FOR UPDATE OF ar`,
      ).bind(input.organizationId, input.actionType, now).all<ApprovalRow>();
      for (const row of stale.results) await expireApproval(database, input.organizationId, row, now);
      const pending = await database.prepare(
        `SELECT id FROM approval_requests WHERE organization_id = ? AND action_type = ?
         AND status = 'pending' AND expires_at > ? LIMIT 1`,
      ).bind(input.organizationId, input.actionType, now).first<{ id: string }>();
      if (pending) throw new ApprovalError('Resolvé o cancelá las solicitudes pendientes antes de desactivar la política.', 409, 'pending_approvals_exist');
    }
    const id = crypto.randomUUID();
    const policy = await database.prepare(
      `INSERT INTO approval_policies (id, organization_id, action_type, enabled, expires_in_minutes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, action_type) DO UPDATE SET enabled = EXCLUDED.enabled,
         expires_in_minutes = EXCLUDED.expires_in_minutes, updated_at = EXCLUDED.updated_at
       RETURNING id, enabled, expires_in_minutes AS "expiresInMinutes", created_at AS "createdAt", updated_at AS "updatedAt"`,
    ).bind(id, input.organizationId, input.actionType, input.enabled ? 1 : 0, input.expiresInMinutes, input.actor.userId, now, now)
      .first<{ id: string; enabled: number; expiresInMinutes: number; createdAt: string; updatedAt: string }>();
    if (!policy) throw new ApprovalError('No pudimos guardar la política.', 500, 'approval_policy_update_failed');
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.policy_updated',
      resourceType: 'approval_policy', resourceId: policy.id, payload: { actionType: input.actionType, enabled: input.enabled,
        expiresInMinutes: input.expiresInMinutes } });
    return { ...policy, actionType: input.actionType, enabled: policy.enabled === 1 };
  });
}

export async function requiresApproval(organizationId: string, actionType: ApprovalActionType, database = getDatabaseClient()) {
  const policy = await database.prepare(
    `SELECT enabled FROM approval_policies WHERE organization_id = ? AND action_type = ? LIMIT 1`,
  ).bind(organizationId, actionType).first<{ enabled: number }>();
  return policy?.enabled === 1;
}

export function requiresSettlementApproval(organizationId: string, database = getDatabaseClient()) {
  return requiresApproval(organizationId, 'settlement.execute', database);
}

async function expireApproval(database: DatabaseClient, organizationId: string, row: ApprovalRow, now: string) {
  await database.prepare(
    `UPDATE approval_requests SET status = 'expired', resolved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
  ).bind(now, now, row.id).run();
  await audit(database, { organizationId, actorId: row.requestedBy, action: 'approval.request_expired',
    resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId } });
  if (row.actionType === 'payout_batch.execute') await closePayoutBatchApprovalInTransaction(database, {
    organizationId, actorId: row.requestedBy, batchId: row.resourceId, approvalRequestId: row.id, outcome: 'expired',
  });
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
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
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

export async function createTransferWithApprovalPolicy(input: TransferCreationInput & {
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ actionType: 'transfer.create', counterparty: input.counterparty,
    description: input.description, amountMinor: input.amountMinor.toString(), currency: input.currency, signals: input.signals ?? {} }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:transfer:${input.idempotencyKey}`).first();
    const existingTransfer = await findTransferByIdempotency(input, database);
    if (existingTransfer) return { requiresApproval: false as const, transaction: existingTransfer, replayed: true };
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint) {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:transfer.create`).first();
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'transfer.create' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await createTransferInTransaction(input, database);
      return { requiresApproval: false as const, ...result };
    }
    const id = crypto.randomUUID(); const resourceId = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = { counterparty: input.counterparty, description: input.description, amountMinor: input.amountMinor.toString(),
      currency: input.currency, signals: input.signals ?? {}, origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'transfer.create', 'transfer', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, resourceId, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId,
      expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'transfer.create', resourceType: 'transfer',
        resourceId, expiresAt, ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

export async function createBookTransferWithApprovalPolicy(input: BookTransferInput & {
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await bookTransferFingerprint(input);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:book-transfer:${input.idempotencyKey}`).first();
    const existingTransfer = await findBookTransferByIdempotency(input, database);
    if (existingTransfer) return { requiresApproval: false as const, transfer: existingTransfer, replayed: true };
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'book_transfer') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:transfer.create`).first();
    const policy = await database.prepare(`SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
      WHERE organization_id = ? AND action_type = 'transfer.create' AND enabled = 1 LIMIT 1`)
      .bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await createBookTransferInTransaction(input, database);
      return { requiresApproval: false as const, ...result };
    }
    const id = crypto.randomUUID(); const resourceId = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = { bookTransfer: true, externalReference: input.externalReference,
      sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId,
      description: input.description, amountMinor: input.amountMinor.toString(), currency: input.currency,
      signals: input.signals ?? {}, origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true };
    await database.prepare(`INSERT INTO approval_requests
      (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
       request_payload, requested_by, expires_at, created_at, updated_at)
      VALUES (?, ?, 'transfer.create', 'book_transfer', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
      .bind(id, input.organizationId, resourceId, input.idempotencyKey, fingerprint, JSON.stringify(payload),
        input.actor.userId, expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'approval.request_created', resourceType: 'approval_request', resourceId: id,
      payload: { actionType: 'transfer.create', resourceType: 'book_transfer', resourceId, expiresAt,
        ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

export async function reverseTransferWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; transactionId: string; idempotencyKey: string;
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ actionType: 'transfer.reverse', transactionId: input.transactionId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:transfer-reverse:${input.idempotencyKey}`).first();
    const existingReversal = await database.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, `reversal:${input.idempotencyKey}`).first<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
      status: string; riskScore: number; reversalOf: string | null; createdAt: string;
    }>();
    if (existingReversal) {
      if (existingReversal.reversalOf !== input.transactionId) {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra reversa.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: false as const, transaction: serializeTransaction(existingReversal), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'transfer' ||
        existingApproval.actionType !== 'transfer.reverse') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:transfer.reverse`).first();
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'transfer.reverse' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await reverseTransactionInTransaction({
        organizationId: input.organizationId, actor: input.actor, transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey, auditAction: 'transfer.reversed',
      }, database);
      return { requiresApproval: false as const, ...result };
    }
    const original = await database.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        idempotency_key AS "idempotencyKey"
       FROM transactions WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.transactionId, input.organizationId).first<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
      status: string; idempotencyKey: string;
    }>();
    if (!original) throw new ApprovalError('Transferencia no encontrada.', 404, 'transaction_not_found');
    if (original.idempotencyKey.startsWith('payment:')) {
      throw new ApprovalError('Esta transacción debe revertirse desde su payment.', 409, 'payment_reverse_required');
    }
    const bookTransfer = await database.prepare('SELECT id FROM book_transfers WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    if (bookTransfer) throw new ApprovalError('Esta transacción debe revertirse desde su book transfer.', 409, 'book_transfer_reverse_required');
    const billPayment = await database.prepare('SELECT id FROM bill_payment_orders WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    if (billPayment) throw new ApprovalError('Esta transacción debe revertirse desde su orden de servicio.', 409, 'bill_payment_reverse_required');
    const instantTransfer = await database.prepare('SELECT id FROM instant_transfers WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    if (instantTransfer) throw new ApprovalError('Esta transacción debe revertirse desde su transferencia instantánea.', 409, 'instant_transfer_return_required');
    const paymentLink = await database.prepare('SELECT id FROM payment_links WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    const collectionCredit = await database.prepare('SELECT id FROM payment_link_credits WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    if (paymentLink || collectionCredit) throw new ApprovalError('Esta transacción debe revertirse desde su link de cobro.', 409, 'collection_refund_required');
    const echeq = await database.prepare('SELECT id FROM echeqs WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, original.id).first<{ id: string }>();
    if (echeq) throw new ApprovalError('El depósito de un ECHEQ no se revierte por la reversa genérica.', 409, 'echeq_deposit_irreversible');
    if (original.status !== 'settled') throw new ApprovalError('Sólo se puede revertir una transferencia liquidada.', 409, 'transaction_not_reversible');
    const alreadyReversed = await database.prepare('SELECT id FROM transactions WHERE reversal_of = ? LIMIT 1')
      .bind(original.id).first<{ id: string }>();
    if (alreadyReversed) throw new ApprovalError('La transferencia ya fue revertida.', 409, 'transaction_already_reversed');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = {
      counterparty: original.counterparty, description: original.description,
      amountMinor: original.amountMinor.replace(/^-/, ''), currency: original.currency,
      origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true,
    };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'transfer.reverse', 'transfer', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, original.id, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId,
      expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'transfer.reverse', resourceType: 'transfer',
        resourceId: original.id, expiresAt, ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

export async function reverseBookTransferWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; transferId: string; idempotencyKey: string;
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ actionType: 'transfer.reverse', bookTransferId: input.transferId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:book-transfer-reverse:${input.idempotencyKey}`).first();
    const existingReversal = await database.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, `reversal:${input.idempotencyKey}`).first<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
      status: string; riskScore: number; reversalOf: string | null; createdAt: string;
    }>();
    if (existingReversal) {
      const book = await database.prepare(
        `SELECT id FROM book_transfers WHERE organization_id = ? AND id = ? AND transaction_id = ? LIMIT 1`,
      ).bind(input.organizationId, input.transferId, existingReversal.reversalOf).first<{ id: string }>();
      if (!book) throw new ApprovalError('La Idempotency-Key ya fue usada para otra reversa.', 409, 'idempotency_mismatch');
      return {
        requiresApproval: false as const,
        transfer: await retrieveBookTransfer(input.organizationId, book.id, database),
        reversal: serializeTransaction(existingReversal),
        replayed: true,
      };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'book_transfer' ||
        existingApproval.actionType !== 'transfer.reverse') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:transfer.reverse`).first();
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'transfer.reverse' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await reverseBookTransferInTransaction(input, database);
      return { requiresApproval: false as const, ...result };
    }
    const transfer = await database.prepare(
      `SELECT id, external_reference AS "externalReference", description, amount_minor::text AS "amountMinor",
        currency, status, source_account_id AS "sourceAccountId", destination_account_id AS "destinationAccountId",
        transaction_id AS "transactionId"
       FROM book_transfers WHERE organization_id = ? AND id = ? FOR UPDATE`,
    ).bind(input.organizationId, input.transferId).first<{
      id: string; externalReference: string; description: string; amountMinor: string; currency: Currency;
      status: string; sourceAccountId: string; destinationAccountId: string; transactionId: string;
    }>();
    if (!transfer) throw new ApprovalError('Book transfer no encontrado.', 404, 'book_transfer_not_found');
    if (transfer.status !== 'settled') throw new ApprovalError('Sólo se puede revertir un book transfer liquidado.', 409, 'transaction_not_reversible');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = {
      bookTransfer: true, externalReference: transfer.externalReference, description: transfer.description,
      amountMinor: transfer.amountMinor, currency: transfer.currency,
      sourceAccountId: transfer.sourceAccountId, destinationAccountId: transfer.destinationAccountId,
      origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true,
    };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'transfer.reverse', 'book_transfer', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, transfer.id, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId,
      expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'transfer.reverse', resourceType: 'book_transfer',
        resourceId: transfer.id, expiresAt, ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

export async function createAccountPaymentWithApprovalPolicy(input: AccountPaymentInput & {
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({
    actionType: 'payment.create', accountId: input.accountId, direction: input.direction,
    counterparty: input.counterparty, description: input.description,
    amountMinor: input.amountMinor.toString(), currency: input.currency, signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment:${input.idempotencyKey}`).first();
    const existingPayment = await findPaymentByIdempotency(input, database);
    if (existingPayment) return { requiresApproval: false as const, payment: existingPayment, replayed: true };
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'payment') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:payment.create`).first();
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'payment.create' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await createAccountPaymentInTransaction(input, database);
      return { requiresApproval: false as const, ...result };
    }
    const id = crypto.randomUUID(); const resourceId = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = {
      accountId: input.accountId, direction: input.direction, counterparty: input.counterparty,
      description: input.description, amountMinor: input.amountMinor.toString(), currency: input.currency,
      signals: input.signals ?? {}, origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true,
    };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'payment.create', 'payment', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, resourceId, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId,
      expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'payment.create', resourceType: 'payment',
        resourceId, expiresAt, ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

export async function reverseAccountPaymentWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; paymentId: string; idempotencyKey: string;
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ actionType: 'payment.reverse', paymentId: input.paymentId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-reverse:${input.idempotencyKey}`).first();
    const existingReversal = await database.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, `reversal:${input.idempotencyKey}`).first<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
      status: string; riskScore: number; reversalOf: string | null; createdAt: string;
    }>();
    if (existingReversal) {
      if (existingReversal.reversalOf !== input.paymentId) {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra reversa.', 409, 'idempotency_mismatch');
      }
      const updated = await database.prepare(
        `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
          risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
         FROM transactions WHERE id = ? AND organization_id = ? LIMIT 1`,
      ).bind(input.paymentId, input.organizationId).first<{
        id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
        status: string; riskScore: number; reversalOf: string | null; createdAt: string;
      }>();
      if (!updated) throw new ApprovalError('Payment no encontrado.', 404, 'payment_not_found');
      return {
        requiresApproval: false as const,
        payment: serializeTransaction(updated),
        reversal: serializeTransaction(existingReversal),
        replayed: true,
      };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
    const existingApproval = await database.prepare(
      `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
    if (existingApproval) {
      if (existingApproval.requestFingerprint !== fingerprint || existingApproval.resourceType !== 'payment' ||
        existingApproval.actionType !== 'payment.reverse') {
        throw new ApprovalError('La Idempotency-Key ya fue usada para otra operación.', 409, 'idempotency_mismatch');
      }
      return { requiresApproval: true as const, approval: serializeApproval(existingApproval), replayed: true, deduplicated: false };
    }
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:payment.reverse`).first();
    const policy = await database.prepare(
      `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
       WHERE organization_id = ? AND action_type = 'payment.reverse' AND enabled = 1 LIMIT 1`,
    ).bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (!policy) {
      const result = await reverseAccountPaymentInTransaction(input, database);
      return { requiresApproval: false as const, ...result };
    }
    const payment = await database.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        CASE WHEN idempotency_key LIKE 'payment:%' AND amount_minor::bigint > 0 THEN 'cash_in'
             WHEN idempotency_key LIKE 'payment:%' AND amount_minor::bigint < 0 THEN 'cash_out'
             ELSE NULL END AS direction
       FROM transactions WHERE id = ? AND organization_id = ? AND idempotency_key LIKE 'payment:%' LIMIT 1 FOR UPDATE`,
    ).bind(input.paymentId, input.organizationId).first<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
      status: string; direction: 'cash_in' | 'cash_out' | null;
    }>();
    if (!payment) throw new ApprovalError('Payment no encontrado.', 404, 'payment_not_found');
    if (payment.status !== 'settled') throw new ApprovalError('Sólo se puede revertir un payment liquidado.', 409, 'transaction_not_reversible');
    const alreadyReversed = await database.prepare('SELECT id FROM transactions WHERE reversal_of = ? LIMIT 1')
      .bind(payment.id).first<{ id: string }>();
    if (alreadyReversed) throw new ApprovalError('El payment ya fue revertido.', 409, 'transaction_already_reversed');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
    const payload = {
      paymentId: payment.id, direction: payment.direction, counterparty: payment.counterparty,
      description: payment.description, amountMinor: payment.amountMinor.replace(/^-/, ''), currency: payment.currency,
      origin: input.authentication, apiKeyId: input.apiKeyId, sandbox: true,
    };
    await database.prepare(
      `INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
       VALUES (?, ?, 'payment.reverse', 'payment', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, payment.id, input.idempotencyKey, fingerprint, JSON.stringify(payload), input.actor.userId,
      expiresAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
      resourceType: 'approval_request', resourceId: id, payload: { actionType: 'payment.reverse', resourceType: 'payment',
        resourceId: payment.id, expiresAt, ...publicApprovalPayload(payload) } });
    const approval = await approvalById(database, input.organizationId, id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
    return { requiresApproval: true as const, approval, replayed: false, deduplicated: false };
  });
}

function transferPayload(row: ApprovalRow) {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    if (typeof payload.counterparty !== 'string' || typeof payload.description !== 'string' ||
      typeof payload.amountMinor !== 'string' || !['ARS', 'MXN', 'COP', 'BRL', 'CLP', 'PEN', 'USD'].includes(String(payload.currency))) return null;
    const amountMinor = BigInt(payload.amountMinor);
    if (amountMinor <= 0n) return null;
    const signals = parseProtectedRiskSignals(payload.signals);
    if (!signals) return null;
    return { counterparty: payload.counterparty, description: payload.description, amountMinor, currency: payload.currency as Currency, signals };
  } catch { return null; }
}

function riskResolutionPayload(row: ApprovalRow): { resolution: 'approved' | 'declined'; note: string } | null {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    if ((payload.resolution !== 'approved' && payload.resolution !== 'declined') ||
      typeof payload.note !== 'string' || payload.note.length < 3) return null;
    return { resolution: payload.resolution, note: payload.note };
  } catch { return null; }
}

function reconciliationResolutionPayload(row: ApprovalRow): { resolution: 'corrected' | 'accepted'; note: string } | null {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    if ((payload.resolution !== 'corrected' && payload.resolution !== 'accepted') ||
      typeof payload.note !== 'string' || payload.note.length < 3) return null;
    return { resolution: payload.resolution, note: payload.note };
  } catch { return null; }
}

function bookTransferPayload(row: ApprovalRow) {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    if (payload.bookTransfer !== true || typeof payload.externalReference !== 'string' ||
      typeof payload.sourceAccountId !== 'string' || typeof payload.destinationAccountId !== 'string' ||
      typeof payload.description !== 'string' || typeof payload.amountMinor !== 'string' ||
      !['ARS', 'MXN', 'COP', 'BRL', 'CLP', 'PEN', 'USD'].includes(String(payload.currency))) return null;
    const amountMinor = BigInt(payload.amountMinor); const signals = parseProtectedRiskSignals(payload.signals);
    if (amountMinor <= 0n || !signals) return null;
    return { externalReference: payload.externalReference, sourceAccountId: payload.sourceAccountId,
      destinationAccountId: payload.destinationAccountId, description: payload.description, amountMinor,
      currency: payload.currency as Currency, signals };
  } catch { return null; }
}

function paymentPayload(row: ApprovalRow) {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    if (typeof payload.accountId !== 'string' || (payload.direction !== 'cash_in' && payload.direction !== 'cash_out') ||
      typeof payload.counterparty !== 'string' || typeof payload.description !== 'string' ||
      typeof payload.amountMinor !== 'string' ||
      !['ARS', 'MXN', 'COP', 'BRL', 'CLP', 'PEN', 'USD'].includes(String(payload.currency))) return null;
    const amountMinor = BigInt(payload.amountMinor);
    const signals = parseProtectedRiskSignals(payload.signals);
    if (amountMinor <= 0n || !signals) return null;
    return {
      accountId: payload.accountId, direction: payload.direction as 'cash_in' | 'cash_out',
      counterparty: payload.counterparty, description: payload.description, amountMinor,
      currency: payload.currency as Currency, signals,
    };
  } catch { return null; }
}

function disputeResolutionPayload(row: ApprovalRow): { event: DisputeEvent; note: string } | null {
  try {
    const payload = JSON.parse(row.requestPayload) as Record<string, unknown>;
    const event = payload.resolution;
    if (!['start_review', 'mark_network_ready', 'resolve_won', 'resolve_lost', 'reject', 'cancel'].includes(String(event)) ||
      typeof payload.note !== 'string' || payload.note.length < 3) return null;
    return { event: event as DisputeEvent, note: payload.note };
  } catch { return null; }
}

type ResolutionApprovalAction = 'risk.case.resolve' | 'reconciliation.exception.resolve' | 'dispute.resolve';

async function resolutionApproval(
  database: DatabaseClient,
  input: {
    organizationId: string; actorId: string; actionType: ResolutionApprovalAction;
    resourceType: 'risk_case' | 'reconciliation_exception' | 'dispute'; resourceId: string;
    idempotencyKey: string; resolution: string; note: string;
  },
  loadPayload: () => Promise<Record<string, unknown>>,
) {
  const fingerprint = await sha256(JSON.stringify({ actionType: input.actionType, resourceId: input.resourceId,
    resolution: input.resolution, note: input.note }));
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:approval:${input.idempotencyKey}`).first();
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:approval:${input.actionType}:${input.resourceId}`).first();
  await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:approval-policy:${input.actionType}`).first();
  const existingKey = await database.prepare(
    `${approvalSelect} WHERE ar.organization_id = ? AND ar.idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, input.idempotencyKey).first<ApprovalRow>();
  if (existingKey) {
    if (existingKey.requestFingerprint !== fingerprint) {
      throw new ApprovalError('La Idempotency-Key ya fue usada para otra aprobación.', 409, 'idempotency_mismatch');
    }
    return { required: true as const, approval: serializeApproval(existingKey), replayed: true, deduplicated: false };
  }
  const policy = await database.prepare(
    `SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
     WHERE organization_id = ? AND action_type = ? AND enabled = 1 LIMIT 1`,
  ).bind(input.organizationId, input.actionType).first<{ expiresInMinutes: number }>();
  if (!policy) return { required: false as const };
  const payload = await loadPayload();
  const now = new Date().toISOString();
  const stale = await database.prepare(
    `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = ? AND ar.resource_id = ?
     AND ar.status = 'pending' AND ar.expires_at <= ? FOR UPDATE OF ar`,
  ).bind(input.organizationId, input.actionType, input.resourceId, now).all<ApprovalRow>();
  for (const row of stale.results) await expireApproval(database, input.organizationId, row, now);
  const pending = await database.prepare(
    `${approvalSelect} WHERE ar.organization_id = ? AND ar.action_type = ? AND ar.resource_id = ?
     AND ar.status = 'pending' AND ar.expires_at > ? ORDER BY ar.created_at DESC LIMIT 1`,
  ).bind(input.organizationId, input.actionType, input.resourceId, now).first<ApprovalRow>();
  if (pending) {
    if (pending.requestFingerprint !== fingerprint) {
      throw new ApprovalError('Ya existe una solicitud pendiente con otra decisión para este recurso.', 409, 'approval_request_conflict');
    }
    return { required: true as const, approval: serializeApproval(pending), replayed: true, deduplicated: true };
  }
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
  const requestPayload = { resolution: input.resolution, note: input.note, ...payload, sandbox: true };
  await database.prepare(
    `INSERT INTO approval_requests
      (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
       request_payload, requested_by, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).bind(id, input.organizationId, input.actionType, input.resourceType, input.resourceId, input.idempotencyKey, fingerprint,
    JSON.stringify(requestPayload), input.actorId, expiresAt, now, now).run();
  await audit(database, { organizationId: input.organizationId, actorId: input.actorId, action: 'approval.request_created',
    resourceType: 'approval_request', resourceId: id, payload: { actionType: input.actionType,
      resourceType: input.resourceType, resourceId: input.resourceId, expiresAt, ...requestPayload } });
  const approval = await approvalById(database, input.organizationId, id);
  if (!approval) throw new ApprovalError('No pudimos recuperar la solicitud.', 500, 'approval_create_failed');
  return { required: true as const, approval, replayed: false, deduplicated: false };
}

export async function resolveRiskCaseWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; caseId: string; resolution: 'approved' | 'declined'; note: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const protectedResult = await resolutionApproval(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, actionType: 'risk.case.resolve',
      resourceType: 'risk_case', resourceId: input.caseId, idempotencyKey: input.idempotencyKey,
      resolution: input.resolution, note: input.note,
    }, async () => {
      const riskCase = await database.prepare(
        `SELECT rc.id, rc.status, rc.hold_id AS "holdId", rc.transaction_id AS "transactionId", rc.priority,
          re.counterparty, re.amount_minor::text AS "amountMinor", re.currency, re.score
         FROM risk_cases rc JOIN risk_evaluations re ON re.id = rc.evaluation_id
         WHERE rc.organization_id = ? AND rc.id = ? FOR UPDATE OF rc`,
      ).bind(input.organizationId, input.caseId).first<{
        id: string; status: string; holdId: string | null; transactionId: string | null; priority: string;
        counterparty: string; amountMinor: string; currency: string; score: number;
      }>();
      if (!riskCase) throw new RiskError('Caso de riesgo no encontrado.', 404, 'risk_case_not_found');
      if (riskCase.status !== 'open') throw new RiskError('El caso ya fue resuelto.', 409, 'risk_case_already_resolved');
      return { holdId: riskCase.holdId, transactionId: riskCase.transactionId, priority: riskCase.priority,
        counterparty: riskCase.counterparty, amountMinor: riskCase.amountMinor, currency: riskCase.currency, score: riskCase.score };
    });
    if (protectedResult.required) return { requiresApproval: true as const, approval: protectedResult.approval,
      replayed: protectedResult.replayed, deduplicated: protectedResult.deduplicated };
    const riskCase = await getRiskCaseForResolution(input.organizationId, input.caseId, database);
    if (!riskCase) throw new RiskError('Caso de riesgo no encontrado.', 404, 'risk_case_not_found');
    if (riskCase.status === 'open' && riskCase.holdId) {
      await resolveHold({ organizationId: input.organizationId, actor: input.actor, holdId: riskCase.holdId,
        action: input.resolution === 'approved' ? 'capture' : 'release', idempotencyKey: `risk:${input.idempotencyKey}` }, database);
    }
    const riskCaseResult = await resolveRiskCase(input, database);
    return { requiresApproval: false as const, case: riskCaseResult, replayed: riskCaseResult.replayed };
  });
}

export async function resolveReconciliationExceptionWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; exceptionId: string; resolution: 'corrected' | 'accepted'; note: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const protectedResult = await resolutionApproval(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, actionType: 'reconciliation.exception.resolve',
      resourceType: 'reconciliation_exception', resourceId: input.exceptionId, idempotencyKey: input.idempotencyKey,
      resolution: input.resolution, note: input.note,
    }, async () => {
      const exception = await database.prepare(
        `SELECT re.id, re.status, re.kind, re.difference_minor::text AS "differenceMinor", ri.external_reference AS "externalReference",
          ri.currency, rr.name AS "runName"
         FROM reconciliation_exceptions re JOIN reconciliation_items ri ON ri.id = re.item_id
         JOIN reconciliation_runs rr ON rr.id = re.run_id
         WHERE re.organization_id = ? AND re.id = ? FOR UPDATE OF re`,
      ).bind(input.organizationId, input.exceptionId).first<{
        id: string; status: string; kind: string; differenceMinor: string; externalReference: string; currency: string; runName: string;
      }>();
      if (!exception) throw new ReconciliationError('Excepción no encontrada.', 404, 'reconciliation_exception_not_found');
      if (exception.status !== 'open') {
        throw new ReconciliationError('La excepción ya fue resuelta.', 409, 'reconciliation_exception_already_resolved');
      }
      return { kind: exception.kind, differenceMinor: exception.differenceMinor, externalReference: exception.externalReference,
        currency: exception.currency, runName: exception.runName };
    });
    if (protectedResult.required) return { requiresApproval: true as const, approval: protectedResult.approval,
      replayed: protectedResult.replayed, deduplicated: protectedResult.deduplicated };
    const exception = await resolveReconciliationException(input, database);
    return { requiresApproval: false as const, exception, replayed: exception.replayed };
  });
}

export async function transitionDisputeWithApprovalPolicy(input: {
  organizationId: string; actor: AuthUser; disputeId: string; event: DisputeEvent; note: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const protectedResult = await resolutionApproval(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, actionType: 'dispute.resolve',
      resourceType: 'dispute', resourceId: input.disputeId, idempotencyKey: input.idempotencyKey,
      resolution: input.event, note: input.note,
    }, async () => {
      const dispute = await database.prepare(
        `SELECT d.status, d.reason, d.amount_minor::text AS "amountMinor", d.currency, d.priority,
          d.provisional_credit_requested AS "provisionalCreditRequested", d.credit_status AS "creditStatus",
          t.counterparty FROM disputes d JOIN transactions t ON t.id = d.transaction_id
         WHERE d.organization_id = ? AND d.id = ? FOR UPDATE OF d`,
      ).bind(input.organizationId, input.disputeId).first<{
        status: DisputeStatus; reason: string; amountMinor: string; currency: string; priority: string;
        provisionalCreditRequested: number; creditStatus: string; counterparty: string;
      }>();
      if (!dispute) throw new DisputeError('Disputa no encontrada.', 404, 'dispute_not_found');
      return { event: input.event, status: dispute.status, reason: dispute.reason, amountMinor: dispute.amountMinor,
        currency: dispute.currency, priority: dispute.priority, provisionalCreditRequested: dispute.provisionalCreditRequested === 1,
        creditStatus: dispute.creditStatus, counterparty: dispute.counterparty };
    });
    if (protectedResult.required) return { requiresApproval: true as const, approval: protectedResult.approval,
      replayed: protectedResult.replayed, deduplicated: protectedResult.deduplicated };
    const result = await transitionDispute(input, database);
    return { requiresApproval: false as const, dispute: result.dispute, replayed: result.replayed };
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
      return { approval: await approvalById(database, input.organizationId, input.requestId), replayed: true, expired: false,
        failed: priorDecision.failure };
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
    let executedTransfer: Awaited<ReturnType<typeof findTransferByIdempotency>> | undefined;
    let executedBookTransfer: Awaited<ReturnType<typeof findBookTransferByIdempotency>> | undefined;
    let executedPayment: Awaited<ReturnType<typeof findPaymentByIdempotency>> | undefined;
    let executedReversal: Awaited<ReturnType<typeof findPaymentByIdempotency>> | undefined;
    let executedPayoutBatch: Awaited<ReturnType<typeof authorizePayoutBatchInTransaction>> | undefined;
    let executedRiskCase: Awaited<ReturnType<typeof resolveRiskCase>> | undefined;
    let executedException: Awaited<ReturnType<typeof resolveReconciliationException>> | undefined;
    let executedDispute: Awaited<ReturnType<typeof transitionDispute>>['dispute'] | undefined;
    let failure: { message: string; code: string; status: number } | undefined;
    if (input.decision === 'reject') {
      await database.prepare(
        `UPDATE approval_requests SET status = 'rejected', resolved_by = ?, resolution_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.actor.userId, input.reason, now, now, row.id).run();
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_rejected',
        resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
          reason: input.reason, decision: input.decision, idempotencyKey: input.idempotencyKey } });
      if (row.actionType === 'payout_batch.execute') await closePayoutBatchApprovalInTransaction(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, batchId: row.resourceId,
        approvalRequestId: row.id, outcome: 'rejected',
      });
    } else {
      if (row.actionType === 'settlement.execute') {
        const execution = await executeSettlementCycleInTransaction(database, { organizationId: input.organizationId, actorId: input.actor.userId,
          cycleId: row.resourceId, idempotencyKey: `approval:${row.id}`, executionMode: approvalExecutionMode(row), approvalAuthorized: true });
        executedCycle = execution.cycle;
      } else if (row.actionType === 'transfer.create') {
        if (row.resourceType === 'book_transfer') {
          const payload = bookTransferPayload(row);
          if (!payload) throw new ApprovalError('El payload protegido del book transfer es inválido.', 500, 'approval_payload_invalid');
          try {
            const execution = await createBookTransferInTransaction({ organizationId: input.organizationId, actor: input.actor,
              idempotencyKey: `approval:${row.id}`, transferId: row.resourceId,
              approvalContext: { requestId: row.id, requestedBy: row.requestedBy }, ...payload }, database);
            if ('declined' in execution) failure = { message: 'La política de riesgo rechazó el book transfer aprobado.', code: 'risk_declined', status: 422 };
            else executedBookTransfer = execution.transfer;
          } catch (error) {
            if (error instanceof BookTransferError && error.status < 500) failure = { message: error.message, code: error.code, status: error.status };
            else throw error;
          }
        } else {
          const payload = transferPayload(row);
          if (!payload) throw new ApprovalError('El payload protegido de la transferencia es inválido.', 500, 'approval_payload_invalid');
          try {
            const execution = await createTransferInTransaction({ organizationId: input.organizationId, actor: input.actor,
              idempotencyKey: `approval:${row.id}`, transactionId: row.resourceId,
              approvalContext: { requestId: row.id, requestedBy: row.requestedBy }, ...payload }, database);
            if ('declined' in execution) failure = { message: 'La política de riesgo rechazó la transferencia aprobada.', code: 'risk_declined', status: 422 };
            else executedTransfer = execution.transaction;
          } catch (error) {
            if (error instanceof LedgerError && error.status === 422) failure = { message: error.message, code: error.code, status: error.status };
            else throw error;
          }
        }
      } else if (row.actionType === 'transfer.reverse') {
        if (row.resourceType === 'book_transfer') {
          try {
            const execution = await reverseBookTransferInTransaction({
              organizationId: input.organizationId, actor: input.actor, transferId: row.resourceId,
              idempotencyKey: `approval:${row.id}`,
              approvalContext: { requestId: row.id, requestedBy: row.requestedBy },
            }, database);
            executedBookTransfer = execution.transfer;
            executedReversal = execution.reversal;
          } catch (error) {
            if ((error instanceof BookTransferError || error instanceof LedgerError) && error.status < 500) {
              failure = { message: error.message, code: error.code, status: error.status };
            } else throw error;
          }
        } else {
          try {
            const execution = await reverseTransactionInTransaction({
              organizationId: input.organizationId, actor: input.actor, transactionId: row.resourceId,
              idempotencyKey: `approval:${row.id}`, auditAction: 'transfer.reversed',
              approvalContext: { requestId: row.id, requestedBy: row.requestedBy },
            }, database);
            executedTransfer = execution.transaction;
            executedReversal = execution.transaction;
          } catch (error) {
            if (error instanceof LedgerError && error.status < 500) failure = { message: error.message, code: error.code, status: error.status };
            else throw error;
          }
        }
      } else if (row.actionType === 'payment.create') {
        const payload = paymentPayload(row);
        if (!payload) throw new ApprovalError('El payload protegido del payment es inválido.', 500, 'approval_payload_invalid');
        try {
          const execution = await createAccountPaymentInTransaction({
            organizationId: input.organizationId, actor: input.actor, idempotencyKey: `approval:${row.id}`,
            paymentId: row.resourceId, approvalContext: { requestId: row.id, requestedBy: row.requestedBy }, ...payload,
          }, database);
          if ('declined' in execution) failure = { message: 'La política de riesgo rechazó el payment aprobado.', code: 'risk_declined', status: 422 };
          else executedPayment = execution.payment;
        } catch (error) {
          if (error instanceof LedgerError && error.status < 500) failure = { message: error.message, code: error.code, status: error.status };
          else throw error;
        }
      } else if (row.actionType === 'payment.reverse') {
        try {
          const execution = await reverseAccountPaymentInTransaction({
            organizationId: input.organizationId, actor: input.actor, paymentId: row.resourceId,
            idempotencyKey: `approval:${row.id}`,
            approvalContext: { requestId: row.id, requestedBy: row.requestedBy },
          }, database);
          executedPayment = execution.payment;
          executedReversal = execution.reversal;
        } catch (error) {
          if (error instanceof LedgerError && error.status < 500) failure = { message: error.message, code: error.code, status: error.status };
          else throw error;
        }
      } else if (row.actionType === 'payout_batch.execute') {
        try {
          executedPayoutBatch = await authorizePayoutBatchInTransaction(database, { organizationId: input.organizationId,
            actorId: input.actor.userId, batchId: row.resourceId, approvalRequestId: row.id });
        } catch (error) {
          if (error instanceof PayoutError && error.status < 500) failure = { message: error.message, code: error.code, status: error.status };
          else throw error;
        }
      } else if (row.actionType === 'risk.case.resolve') {
        const payload = riskResolutionPayload(row);
        if (!payload) throw new ApprovalError('El payload protegido del caso es inválido.', 500, 'approval_payload_invalid');
        const riskCase = await getRiskCaseForResolution(input.organizationId, row.resourceId, database);
        if (!riskCase || riskCase.status !== 'open') {
          failure = { message: 'El caso ya no está abierto para resolución.', code: 'risk_case_not_open', status: 409 };
        } else {
          if (riskCase.holdId) {
            await resolveHold({ organizationId: input.organizationId, actor: input.actor, holdId: riskCase.holdId,
              action: payload.resolution === 'approved' ? 'capture' : 'release', idempotencyKey: `approval:${row.id}:hold`,
              approvalAuthorized: true }, database);
          }
          executedRiskCase = await resolveRiskCase({ organizationId: input.organizationId, actor: input.actor,
            caseId: row.resourceId, ...payload, idempotencyKey: `approval:${row.id}`,
            approvalContext: { requestId: row.id, requestedBy: row.requestedBy } }, database);
        }
      } else if (row.actionType === 'reconciliation.exception.resolve') {
        const payload = reconciliationResolutionPayload(row);
        if (!payload) throw new ApprovalError('El payload protegido de la excepción es inválido.', 500, 'approval_payload_invalid');
        const exception = await database.prepare(
          `SELECT status FROM reconciliation_exceptions WHERE organization_id = ? AND id = ? FOR UPDATE`,
        ).bind(input.organizationId, row.resourceId).first<{ status: string }>();
        if (!exception || exception.status !== 'open') {
          failure = { message: 'La excepción ya no está abierta para resolución.', code: 'reconciliation_exception_not_open', status: 409 };
        } else {
          executedException = await resolveReconciliationException({ organizationId: input.organizationId, actor: input.actor,
            exceptionId: row.resourceId, ...payload, idempotencyKey: `approval:${row.id}`,
            approvalContext: { requestId: row.id, requestedBy: row.requestedBy } }, database);
        }
      } else {
        const payload = disputeResolutionPayload(row);
        if (!payload) throw new ApprovalError('El payload protegido de la disputa es inválido.', 500, 'approval_payload_invalid');
        try {
          const execution = await transitionDispute({ organizationId: input.organizationId, actor: input.actor,
            disputeId: row.resourceId, ...payload, idempotencyKey: `approval:${row.id}`,
            approvalContext: { requestId: row.id, requestedBy: row.requestedBy } }, database);
          executedDispute = execution.dispute;
        } catch (error) {
          if (error instanceof DisputeError && error.status === 409) {
            failure = { message: error.message, code: error.code, status: error.status };
          } else throw error;
        }
      }
      if (failure) {
        await database.prepare(
          `UPDATE approval_requests SET status = 'failed', resolved_by = ?, resolution_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(input.actor.userId, failure.message, now, now, row.id).run();
        await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_failed',
          resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
            requesterId: row.requestedBy, reason: input.reason, decision: input.decision, idempotencyKey: input.idempotencyKey, failure } });
        if (row.actionType === 'payout_batch.execute') await closePayoutBatchApprovalInTransaction(database, {
          organizationId: input.organizationId, actorId: input.actor.userId, batchId: row.resourceId,
          approvalRequestId: row.id, outcome: 'failed',
        });
      } else {
        await database.prepare(
          `UPDATE approval_requests SET status = 'executed', resolved_by = ?, resolution_reason = ?, resolved_at = ?, executed_at = ?, updated_at = ? WHERE id = ?`,
        ).bind(input.actor.userId, input.reason || null, now, now, now, row.id).run();
        await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_executed',
          resourceType: 'approval_request', resourceId: row.id, payload: { actionType: row.actionType, resourceId: row.resourceId,
            requesterId: row.requestedBy, reason: input.reason || null, decision: input.decision, idempotencyKey: input.idempotencyKey } });
      }
    }
    const approval = await approvalById(database, input.organizationId, row.id);
    if (!approval) throw new ApprovalError('No pudimos recuperar la decisión.', 500, 'approval_decision_failed');
    return { approval, cycle: executedCycle, transaction: executedTransfer, bookTransfer: executedBookTransfer,
      payment: executedPayment, reversal: executedReversal, payoutBatch: executedPayoutBatch, case: executedRiskCase,
      exception: executedException, dispute: executedDispute, failed: failure, replayed: false, expired: false };
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
    if (row.actionType === 'payout_batch.execute') await closePayoutBatchApprovalInTransaction(database, {
      organizationId: input.organizationId, actorId: input.actorId, batchId: row.resourceId,
      approvalRequestId: row.id, outcome: 'cancelled',
    });
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
