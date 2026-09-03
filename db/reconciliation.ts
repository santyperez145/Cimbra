import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import { matchReconciliationEntries } from '@/app/lib/platform/reconciliation';
import { type DatabaseClient, getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';

export type ReconciliationSource = 'bank' | 'clearing' | 'card_network' | 'cash_network' | 'internal';
export type ReconciliationEntry = { externalReference: string; transactionId: string | null; actualMinor: bigint };

export class ReconciliationError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'reconciliation_error') { super(message); }
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceType: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType, input.resourceId, JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action, resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

type RunRow = {
  id: string; name: string; source: ReconciliationSource; currency: Currency; periodStart: string; periodEnd: string; status: string;
  ingestionMode: 'api' | 'csv'; fileName: string | null; fileSha256: string | null;
  expectedMinor: string; actualMinor: string; differenceMinor: string; matchedCount: number; exceptionCount: number; createdAt: string; updatedAt: string;
};

function serializeRun(run: RunRow) {
  return {
    ...run,
    expected: minorToMajorNumber(run.expectedMinor, run.currency), actual: minorToMajorNumber(run.actualMinor, run.currency),
    difference: minorToMajorNumber(run.differenceMinor, run.currency),
  };
}

export async function createReconciliationRun(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; name: string; source: ReconciliationSource; currency: Currency;
  periodStart: string; periodEnd: string; entries: ReconciliationEntry[]; ingestionMode?: 'api' | 'csv'; fileName?: string | null; fileSha256?: string | null;
}) {
  const canonicalEntries = [...input.entries].sort((a, b) => a.externalReference.localeCompare(b.externalReference))
    .map((entry) => ({ externalReference: entry.externalReference, transactionId: entry.transactionId, actualMinor: entry.actualMinor.toString() }));
  const fingerprint = await sha256(JSON.stringify({ name: input.name, source: input.source, currency: input.currency,
    periodStart: input.periodStart, periodEnd: input.periodEnd, ingestionMode: input.ingestionMode ?? 'api', fileName: input.fileName ?? null,
    fileSha256: input.fileSha256 ?? null, entries: canonicalEntries }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:reconciliation:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `SELECT id, request_fingerprint AS "requestFingerprint", name, source, currency, ingestion_mode AS "ingestionMode",
        file_name AS "fileName", file_sha256 AS "fileSha256", period_start AS "periodStart", period_end AS "periodEnd",
        status, expected_minor::text AS "expectedMinor", actual_minor::text AS "actualMinor", difference_minor::text AS "differenceMinor",
        matched_count AS "matchedCount", exception_count AS "exceptionCount", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM reconciliation_runs WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<RunRow & { requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new ReconciliationError('La Idempotency-Key ya fue usada con otro lote.', 409, 'idempotency_mismatch');
      return { run: serializeRun(existing), replayed: true };
    }

    const internalRows = await database.prepare(
      `SELECT id, amount_minor::text AS "amountMinor" FROM transactions
       WHERE organization_id = ? AND currency = ? AND status IN ('settled', 'reversed') AND created_at >= ? AND created_at <= ?
       ORDER BY created_at, id`,
    ).bind(input.organizationId, input.currency, input.periodStart, input.periodEnd).all<{ id: string; amountMinor: string }>();
    const items = matchReconciliationEntries(internalRows.results, input.entries);
    const expectedMinor = items.reduce((total, item) => total + item.expectedMinor, 0n);
    const actualMinor = items.reduce((total, item) => total + item.actualMinor, 0n);
    const matchedCount = items.filter((item) => item.status === 'matched').length;
    const exceptionCount = items.length - matchedCount;
    const runId = crypto.randomUUID(); const now = new Date().toISOString();
    const runStatus = exceptionCount === 0 ? 'completed' : 'open';
    await database.prepare(
      `INSERT INTO reconciliation_runs
        (id, organization_id, idempotency_key, request_fingerprint, name, source, currency, ingestion_mode, file_name, file_sha256, period_start, period_end, status,
         expected_minor, actual_minor, difference_minor, matched_count, exception_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(runId, input.organizationId, input.idempotencyKey, fingerprint, input.name, input.source, input.currency, input.ingestionMode ?? 'api',
      input.fileName ?? null, input.fileSha256 ?? null, input.periodStart, input.periodEnd,
      runStatus, expectedMinor.toString(), actualMinor.toString(), (actualMinor - expectedMinor).toString(), matchedCount, exceptionCount,
      input.actor.userId, now, now).run();
    for (const item of items) {
      await database.prepare(
        `INSERT INTO reconciliation_items
          (id, organization_id, run_id, transaction_id, external_reference, expected_minor, actual_minor, difference_minor, currency, status, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(item.id, input.organizationId, runId, item.transactionId, item.externalReference, item.expectedMinor.toString(), item.actualMinor.toString(),
        item.differenceMinor.toString(), input.currency, item.status, item.reason, now).run();
      if (item.status !== 'matched') {
        const kind = item.status === 'mismatch' ? 'amount_mismatch' : item.status;
        await database.prepare(
          `INSERT INTO reconciliation_exceptions
            (id, organization_id, run_id, item_id, kind, difference_minor, status, priority, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', 'medium', ?, ?, ?)`,
        ).bind(crypto.randomUUID(), input.organizationId, runId, item.id, kind, item.differenceMinor.toString(),
          new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(), now, now).run();
      }
    }
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'reconciliation.run_created',
      resourceType: 'reconciliation_run', resourceId: runId, payload: { source: input.source, currency: input.currency, matchedCount, exceptionCount } });
    return { run: serializeRun({ id: runId, name: input.name, source: input.source, currency: input.currency, periodStart: input.periodStart,
      periodEnd: input.periodEnd, status: runStatus, ingestionMode: input.ingestionMode ?? 'api', fileName: input.fileName ?? null,
      fileSha256: input.fileSha256 ?? null, expectedMinor: expectedMinor.toString(), actualMinor: actualMinor.toString(),
      differenceMinor: (actualMinor - expectedMinor).toString(), matchedCount, exceptionCount, createdAt: now, updatedAt: now }), replayed: false };
  });
}

export async function listReconciliationState(organizationId: string) {
  const database = getDatabaseClient();
  const [runs, exceptions] = await Promise.all([
    database.prepare(
      `SELECT id, name, source, currency, ingestion_mode AS "ingestionMode", file_name AS "fileName", file_sha256 AS "fileSha256",
        period_start AS "periodStart", period_end AS "periodEnd", status,
        expected_minor::text AS "expectedMinor", actual_minor::text AS "actualMinor", difference_minor::text AS "differenceMinor",
        matched_count AS "matchedCount", exception_count AS "exceptionCount", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM reconciliation_runs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(organizationId).all<RunRow>(),
    database.prepare(
      `SELECT e.id, e.run_id AS "runId", e.item_id AS "itemId", e.kind, e.difference_minor::text AS "differenceMinor", e.status,
        e.resolution, e.resolution_note AS "resolutionNote", e.resolved_at AS "resolvedAt", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
        i.external_reference AS "externalReference", i.transaction_id AS "transactionId", i.expected_minor::text AS "expectedMinor",
        i.actual_minor::text AS "actualMinor", i.currency, i.reason
       FROM reconciliation_exceptions e JOIN reconciliation_items i ON i.id = e.item_id
       WHERE e.organization_id = ? ORDER BY e.created_at DESC LIMIT 200`,
    ).bind(organizationId).all<Record<string, unknown> & { differenceMinor: string; expectedMinor: string; actualMinor: string; currency: Currency }>(),
  ]);
  return {
    runs: runs.results.map(serializeRun),
    exceptions: exceptions.results.map((item) => ({ ...item, difference: minorToMajorNumber(item.differenceMinor, item.currency),
      expected: minorToMajorNumber(item.expectedMinor, item.currency), actual: minorToMajorNumber(item.actualMinor, item.currency) })),
  };
}

export async function retrieveReconciliationRun(organizationId: string, id: string) {
  const database = getDatabaseClient();
  const run = await database.prepare(
    `SELECT id, name, source, currency, ingestion_mode AS "ingestionMode", file_name AS "fileName", file_sha256 AS "fileSha256",
      period_start AS "periodStart", period_end AS "periodEnd", status,
      expected_minor::text AS "expectedMinor", actual_minor::text AS "actualMinor", difference_minor::text AS "differenceMinor",
      matched_count AS "matchedCount", exception_count AS "exceptionCount", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM reconciliation_runs WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(id, organizationId).first<RunRow>();
  if (!run) return null;
  const items = await database.prepare(
    `SELECT id, transaction_id AS "transactionId", external_reference AS "externalReference", expected_minor::text AS "expectedMinor",
      actual_minor::text AS "actualMinor", difference_minor::text AS "differenceMinor", currency, status, reason, created_at AS "createdAt"
     FROM reconciliation_items WHERE run_id = ? AND organization_id = ? ORDER BY created_at, id`,
  ).bind(id, organizationId).all<Record<string, unknown> & { expectedMinor: string; actualMinor: string; differenceMinor: string; currency: Currency }>();
  return { ...serializeRun(run), items: items.results.map((item) => ({ ...item, expected: minorToMajorNumber(item.expectedMinor, item.currency),
    actual: minorToMajorNumber(item.actualMinor, item.currency), difference: minorToMajorNumber(item.differenceMinor, item.currency) })) };
}

export async function resolveReconciliationException(input: {
  organizationId: string; actor: AuthUser; exceptionId: string; resolution: 'corrected' | 'accepted'; note: string; idempotencyKey: string;
  approvalContext?: { requestId: string; requestedBy: string };
}, database: DatabaseClient = getDatabaseClient()) {
  return database.transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:reconciliation-exception:${input.idempotencyKey}`).first();
    const keyOwner = await database.prepare(
      `SELECT id FROM reconciliation_exceptions WHERE organization_id = ? AND resolution_idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
    if (keyOwner && keyOwner.id !== input.exceptionId) throw new ReconciliationError('La Idempotency-Key ya resolvió otra excepción.', 409, 'idempotency_mismatch');
    const current = await database.prepare(
      `SELECT id, run_id AS "runId", item_id AS "itemId", status, resolution, resolution_idempotency_key AS "resolutionIdempotencyKey"
       FROM reconciliation_exceptions WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.exceptionId, input.organizationId).first<{ id: string; runId: string; itemId: string; status: string; resolution: string | null; resolutionIdempotencyKey: string | null }>();
    if (!current) throw new ReconciliationError('Excepción no encontrada.', 404, 'reconciliation_exception_not_found');
    if (current.status !== 'open') {
      if (current.resolution === input.resolution && current.resolutionIdempotencyKey === input.idempotencyKey) return { id: current.id, status: current.status, resolution: current.resolution, replayed: true };
      throw new ReconciliationError('La excepción ya fue resuelta.', 409, 'reconciliation_exception_already_resolved');
    }
    const now = new Date().toISOString(); const status = input.resolution === 'accepted' ? 'accepted' : 'resolved';
    await database.prepare(
      `UPDATE reconciliation_exceptions SET status = ?, resolution = ?, resolution_note = ?, resolution_idempotency_key = ?,
        resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(status, input.resolution, input.note, input.idempotencyKey, input.actor.userId, now, now, input.exceptionId).run();
    await database.prepare(`UPDATE reconciliation_items SET status = 'resolved' WHERE id = ?`).bind(current.itemId).run();
    const remaining = await database.prepare(
      `SELECT COUNT(*)::int AS count FROM reconciliation_exceptions WHERE run_id = ? AND status = 'open'`,
    ).bind(current.runId).first<{ count: number }>();
    if (Number(remaining?.count ?? 0) === 0) await database.prepare(`UPDATE reconciliation_runs SET status = 'completed', updated_at = ? WHERE id = ?`).bind(now, current.runId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'reconciliation.exception_resolved',
      resourceType: 'reconciliation_exception', resourceId: input.exceptionId, payload: { runId: current.runId,
        resolution: input.resolution, note: input.note, approvalRequestId: input.approvalContext?.requestId,
        requestedBy: input.approvalContext?.requestedBy } });
    return { id: input.exceptionId, status, resolution: input.resolution, replayed: false };
  });
}

/** Libera asignaciones abiertas cuando identity degrada o remueve un miembro. */
export async function clearOpenReconciliationAssignments(
  organizationId: string,
  assigneeUserId: string,
  updatedAt: string,
  database: DatabaseClient = getDatabaseClient(),
) {
  const result = await database.prepare(
    `UPDATE reconciliation_exceptions SET assigned_to = NULL, updated_at = ? WHERE organization_id = ? AND assigned_to = ? AND status = 'open'`,
  ).bind(updatedAt, organizationId, assigneeUserId).run();
  return result.rowsAffected;
}
