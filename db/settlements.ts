import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import { type DatabaseClient, getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';

export type SettlementRail = 'bank' | 'clearing' | 'card_network' | 'cash_network' | 'internal';
export type SettlementStatus = 'ready' | 'scheduled' | 'settled';

export class SettlementError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'settlement_error') { super(message); }
}

type CycleRow = {
  id: string; reconciliationRunId: string; name: string; rail: SettlementRail; currency: Currency; periodStart: string; periodEnd: string;
  netMinor: string; differenceMinor: string; status: SettlementStatus; scheduledFor: string | null; settledAt: string | null;
  createdAt: string; updatedAt: string;
};

function serializeCycle(cycle: CycleRow) {
  return { ...cycle, net: minorToMajorNumber(cycle.netMinor, cycle.currency), difference: minorToMajorNumber(cycle.differenceMinor, cycle.currency) };
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, 'settlement_cycle', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceId, JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: 'settlement_cycle', resourceId: input.resourceId, data: input.payload });
}

const cycleSelect = `SELECT id, reconciliation_run_id AS "reconciliationRunId", name, rail, currency,
  period_start AS "periodStart", period_end AS "periodEnd", net_minor::text AS "netMinor",
  difference_minor::text AS "differenceMinor", status, scheduled_for AS "scheduledFor", settled_at AS "settledAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function createSettlementCycle(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; reconciliationRunId: string; name: string; scheduledFor: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ reconciliationRunId: input.reconciliationRunId, name: input.name, scheduledFor: input.scheduledFor }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:settlement:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `${cycleSelect}, request_fingerprint AS "requestFingerprint" FROM settlement_cycles
       WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<CycleRow & { requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new SettlementError('La Idempotency-Key ya fue usada con otro ciclo.', 409, 'idempotency_mismatch');
      return { cycle: serializeCycle(existing), replayed: true };
    }
    const run = await database.prepare(
      `SELECT id, source, currency, period_start AS "periodStart", period_end AS "periodEnd", status,
        actual_minor::text AS "actualMinor", difference_minor::text AS "differenceMinor"
       FROM reconciliation_runs WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.reconciliationRunId, input.organizationId).first<{
      id: string; source: SettlementRail; currency: Currency; periodStart: string; periodEnd: string; status: string; actualMinor: string; differenceMinor: string;
    }>();
    if (!run) throw new SettlementError('Conciliación no encontrada.', 404, 'reconciliation_run_not_found');
    if (run.status !== 'completed') throw new SettlementError('La conciliación debe cerrar sus excepciones antes del settlement.', 409, 'reconciliation_not_completed');
    const priorCycle = await database.prepare(
      `SELECT id FROM settlement_cycles WHERE reconciliation_run_id = ? LIMIT 1`,
    ).bind(run.id).first<{ id: string }>();
    if (priorCycle) throw new SettlementError('La conciliación ya pertenece a otro ciclo de settlement.', 409, 'settlement_cycle_exists');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const status: SettlementStatus = input.scheduledFor && input.scheduledFor > now ? 'scheduled' : 'ready';
    await database.prepare(
      `INSERT INTO settlement_cycles
        (id, organization_id, reconciliation_run_id, idempotency_key, request_fingerprint, name, rail, currency, period_start, period_end,
         net_minor, difference_minor, status, scheduled_for, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, run.id, input.idempotencyKey, fingerprint, input.name, run.source, run.currency, run.periodStart, run.periodEnd,
      run.actualMinor, run.differenceMinor, status, input.scheduledFor, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'settlement.cycle_created', resourceId: id,
      payload: { reconciliationRunId: run.id, status, scheduledFor: input.scheduledFor, netMinor: run.actualMinor, currency: run.currency, sandbox: true } });
    return { cycle: serializeCycle({ id, reconciliationRunId: run.id, name: input.name, rail: run.source, currency: run.currency,
      periodStart: run.periodStart, periodEnd: run.periodEnd, netMinor: run.actualMinor, differenceMinor: run.differenceMinor,
      status, scheduledFor: input.scheduledFor, settledAt: null, createdAt: now, updatedAt: now }), replayed: false };
  });
}

export async function listSettlementCycles(organizationId: string) {
  const cycles = await getDatabaseClient().prepare(
    `${cycleSelect} FROM settlement_cycles WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(organizationId).all<CycleRow>();
  return cycles.results.map(serializeCycle);
}

export async function retrieveSettlementCycle(organizationId: string, id: string) {
  const cycle = await getDatabaseClient().prepare(
    `${cycleSelect} FROM settlement_cycles WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(id, organizationId).first<CycleRow>();
  return cycle ? serializeCycle(cycle) : null;
}

export async function executeSettlementCycleInTransaction(database: DatabaseClient, input: {
  organizationId: string; actorId: string; cycleId: string; idempotencyKey: string; executionMode: 'manual' | 'scheduled';
  approvalAuthorized?: boolean;
}) {
  await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:approval-policy:settlement.execute`).first();
  if (!input.approvalAuthorized) {
    const policy = await database.prepare(
      `SELECT enabled FROM approval_policies WHERE organization_id = ? AND action_type = 'settlement.execute' LIMIT 1`,
    ).bind(input.organizationId).first<{ enabled: number }>();
    if (policy?.enabled === 1) {
      throw new SettlementError('La política maker/checker exige una solicitud aprobada.', 409, 'approval_required');
    }
  }
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:settlement-cycle:${input.cycleId}`).first();
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:settlement-execution:${input.idempotencyKey}`).first();
  const keyOwner = await database.prepare(
    `SELECT id FROM settlement_cycles WHERE organization_id = ? AND execution_idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
  if (keyOwner && keyOwner.id !== input.cycleId) throw new SettlementError('La Idempotency-Key ya ejecutó otro ciclo.', 409, 'idempotency_mismatch');
  const cycle = await database.prepare(
    `${cycleSelect}, execution_idempotency_key AS "executionIdempotencyKey" FROM settlement_cycles
     WHERE id = ? AND organization_id = ? FOR UPDATE`,
  ).bind(input.cycleId, input.organizationId).first<CycleRow & { executionIdempotencyKey: string | null }>();
  if (!cycle) throw new SettlementError('Ciclo de settlement no encontrado.', 404, 'settlement_cycle_not_found');
  if (cycle.status === 'settled') {
    if (cycle.executionIdempotencyKey === input.idempotencyKey) return { cycle: serializeCycle(cycle), replayed: true };
    throw new SettlementError('El ciclo ya fue ejecutado.', 409, 'settlement_cycle_already_executed');
  }
  const now = new Date().toISOString();
  if (cycle.scheduledFor && cycle.scheduledFor > now) throw new SettlementError('El ciclo todavía no alcanzó su horario programado.', 409, 'settlement_not_due');
  await database.prepare(
    `UPDATE settlement_cycles SET status = 'settled', execution_idempotency_key = ?, settled_by = ?, settled_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.idempotencyKey, input.actorId, now, now, cycle.id).run();
  const settled = { ...cycle, status: 'settled' as const, settledAt: now, updatedAt: now };
  await audit(database, { organizationId: input.organizationId, actorId: input.actorId, action: 'settlement.cycle_settled', resourceId: cycle.id,
    payload: { reconciliationRunId: cycle.reconciliationRunId, executionMode: input.executionMode, netMinor: cycle.netMinor,
      differenceMinor: cycle.differenceMinor, currency: cycle.currency, sandbox: true } });
  return { cycle: serializeCycle(settled), replayed: false };
}

export function executeSettlementCycle(input: {
  organizationId: string; actorId: string; cycleId: string; idempotencyKey: string; executionMode: 'manual' | 'scheduled';
}, client: DatabaseClient = getDatabaseClient()) {
  return client.transaction((database) => executeSettlementCycleInTransaction(database, input));
}
