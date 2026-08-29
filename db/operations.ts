import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import { enqueueWebhookEvent } from './platform';
import { type DatabaseClient, getDatabaseClient } from './client';

export type WorkItemType = 'risk_case' | 'reconciliation_exception' | 'dispute';
export type WorkItemPriority = 'low' | 'medium' | 'high' | 'critical';
export type WorkItemRouteType = 'risk-case' | 'reconciliation-exception' | 'dispute';

export class OperationsError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'operations_error') { super(message); }
}

export function workItemType(value: string): WorkItemType | null {
  if (value === 'risk-case') return 'risk_case';
  if (value === 'reconciliation-exception') return 'reconciliation_exception';
  if (value === 'dispute') return 'dispute';
  return null;
}

type WorkItemRow = {
  id: string; type: WorkItemType; status: string; priority: WorkItemPriority; assignedTo: string | null;
  assigneeName: string | null; assigneeEmail: string | null; dueAt: string | null; escalatedAt: string | null;
  createdAt: string; updatedAt: string; reference: string; summary: string; amountMinor: string; currency: Currency;
  noteCount: number; evidenceCount: number; metadata: Record<string, unknown>;
};

function openWorkItem(type: WorkItemType, status: string) {
  return type === 'dispute' ? ['opened', 'under_review', 'network_ready'].includes(status) : status === 'open';
}

function slaStatus(open: boolean, dueAt: string | null) {
  if (!open || !dueAt) return 'none' as const;
  const remaining = Date.parse(dueAt) - Date.now();
  if (remaining < 0) return 'overdue' as const;
  if (remaining <= 4 * 60 * 60 * 1000) return 'due_soon' as const;
  return 'on_track' as const;
}

function serializeWorkItem(row: WorkItemRow) {
  const open = openWorkItem(row.type, row.status);
  return {
    id: row.id, type: row.type, status: row.status, open, priority: row.priority,
    assignee: row.assignedTo ? { userId: row.assignedTo, displayName: row.assigneeName ?? 'Miembro', email: row.assigneeEmail ?? '' } : null,
    dueAt: row.dueAt, escalatedAt: row.escalatedAt, slaStatus: slaStatus(open, row.dueAt),
    reference: row.reference, summary: row.summary, amountMinor: row.amountMinor,
    amount: minorToMajorNumber(row.amountMinor, row.currency), currency: row.currency,
    noteCount: Number(row.noteCount), evidenceCount: Number(row.evidenceCount), metadata: row.metadata,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function getWorkItemRow(database: DatabaseClient, organizationId: string, type: WorkItemType, id: string, lock = false) {
  if (type === 'risk_case') {
    const suffix = lock ? ' FOR UPDATE OF c' : '';
    const row = await database.prepare(
      `SELECT c.id, 'risk_case' AS type, c.status, c.priority, c.assigned_to AS "assignedTo",
        u.display_name AS "assigneeName", u.email AS "assigneeEmail", c.due_at AS "dueAt", c.escalated_at AS "escalatedAt",
        c.created_at AS "createdAt", c.updated_at AS "updatedAt", e.counterparty AS reference,
        ('Evaluación de riesgo · score ' || e.score::text) AS summary, e.amount_minor::text AS "amountMinor", e.currency,
        (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = c.organization_id AND n.subject_type = 'risk_case' AND n.subject_id = c.id) AS "noteCount",
        (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = c.organization_id AND l.subject_type = 'risk_case' AND l.subject_id = c.id) AS "evidenceCount",
        jsonb_build_object('evaluationId', c.evaluation_id, 'transactionId', c.transaction_id, 'holdId', c.hold_id,
          'score', e.score, 'decision', e.decision, 'reasons', e.reasons::jsonb) AS metadata
       FROM risk_cases c JOIN risk_evaluations e ON e.id = c.evaluation_id LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.organization_id = ? AND c.id = ?${suffix}`,
    ).bind(organizationId, id).first<WorkItemRow>();
    return row ?? null;
  }
  if (type === 'dispute') {
    const suffix = lock ? ' FOR UPDATE OF d' : '';
    const row = await database.prepare(
      `SELECT d.id, 'dispute' AS type, d.status, d.priority, d.assigned_to AS "assignedTo",
        u.display_name AS "assigneeName", u.email AS "assigneeEmail", d.due_at AS "dueAt", d.escalated_at AS "escalatedAt",
        d.created_at AS "createdAt", d.updated_at AS "updatedAt", t.counterparty AS reference,
        ('Disputa · ' || replace(d.reason, '_', ' ')) AS summary, d.amount_minor::text AS "amountMinor", d.currency,
        (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = d.organization_id AND n.subject_type = 'dispute' AND n.subject_id = d.id) AS "noteCount",
        (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = d.organization_id AND l.subject_type = 'dispute' AND l.subject_id = d.id) AS "evidenceCount",
        jsonb_build_object('transactionId', d.transaction_id, 'reason', d.reason, 'creditStatus', d.credit_status,
          'provisionalCreditRequested', d.provisional_credit_requested = 1) AS metadata
       FROM disputes d JOIN transactions t ON t.id = d.transaction_id LEFT JOIN users u ON u.id = d.assigned_to
       WHERE d.organization_id = ? AND d.id = ?${suffix}`,
    ).bind(organizationId, id).first<WorkItemRow>();
    return row ?? null;
  }
  const suffix = lock ? ' FOR UPDATE OF e' : '';
  const row = await database.prepare(
    `SELECT e.id, 'reconciliation_exception' AS type, e.status, e.priority, e.assigned_to AS "assignedTo",
      u.display_name AS "assigneeName", u.email AS "assigneeEmail", e.due_at AS "dueAt", e.escalated_at AS "escalatedAt",
      e.created_at AS "createdAt", e.updated_at AS "updatedAt", i.external_reference AS reference,
      ('Excepción de conciliación · ' || replace(e.kind, '_', ' ')) AS summary, e.difference_minor::text AS "amountMinor", i.currency,
      (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = e.organization_id AND n.subject_type = 'reconciliation_exception' AND n.subject_id = e.id) AS "noteCount",
      (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = e.organization_id AND l.subject_type = 'reconciliation_exception' AND l.subject_id = e.id) AS "evidenceCount",
      jsonb_build_object('runId', e.run_id, 'itemId', e.item_id, 'transactionId', i.transaction_id,
        'kind', e.kind, 'expectedMinor', i.expected_minor::text, 'actualMinor', i.actual_minor::text) AS metadata
     FROM reconciliation_exceptions e JOIN reconciliation_items i ON i.id = e.item_id LEFT JOIN users u ON u.id = e.assigned_to
     WHERE e.organization_id = ? AND e.id = ?${suffix}`,
  ).bind(organizationId, id).first<WorkItemRow>();
  return row ?? null;
}

async function requireWorkItem(database: DatabaseClient, organizationId: string, type: WorkItemType, id: string, lock = false) {
  const row = await getWorkItemRow(database, organizationId, type, id, lock);
  if (!row) throw new OperationsError('Caso operativo no encontrado.', 404, 'work_item_not_found');
  return row;
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceId: string; payload: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, 'work_item', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceId, JSON.stringify(input.payload), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: 'work_item', resourceId: input.resourceId, data: input.payload });
}

async function existingAction(database: DatabaseClient, organizationId: string, idempotencyKey: string, fingerprint: string) {
  const action = await database.prepare(
    `SELECT id, request_fingerprint AS "requestFingerprint" FROM operational_actions
     WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(organizationId, idempotencyKey).first<{ id: string; requestFingerprint: string }>();
  if (action && action.requestFingerprint !== fingerprint) {
    throw new OperationsError('La Idempotency-Key ya fue usada con otra operación.', 409, 'idempotency_mismatch');
  }
  return action;
}

export async function listOperationalWork(organizationId: string) {
  const database = getDatabaseClient();
  const [risk, reconciliation, disputes, members, documents, notes, evidence] = await Promise.all([
    database.prepare(
      `SELECT c.id, 'risk_case' AS type, c.status, c.priority, c.assigned_to AS "assignedTo",
        u.display_name AS "assigneeName", u.email AS "assigneeEmail", c.due_at AS "dueAt", c.escalated_at AS "escalatedAt",
        c.created_at AS "createdAt", c.updated_at AS "updatedAt", e.counterparty AS reference,
        ('Evaluación de riesgo · score ' || e.score::text) AS summary, e.amount_minor::text AS "amountMinor", e.currency,
        (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = c.organization_id AND n.subject_type = 'risk_case' AND n.subject_id = c.id) AS "noteCount",
        (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = c.organization_id AND l.subject_type = 'risk_case' AND l.subject_id = c.id) AS "evidenceCount",
        jsonb_build_object('evaluationId', c.evaluation_id, 'transactionId', c.transaction_id, 'holdId', c.hold_id,
          'score', e.score, 'decision', e.decision, 'reasons', e.reasons::jsonb) AS metadata
       FROM risk_cases c JOIN risk_evaluations e ON e.id = c.evaluation_id LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.organization_id = ? ORDER BY c.created_at DESC LIMIT 200`,
    ).bind(organizationId).all<WorkItemRow>(),
    database.prepare(
      `SELECT e.id, 'reconciliation_exception' AS type, e.status, e.priority, e.assigned_to AS "assignedTo",
        u.display_name AS "assigneeName", u.email AS "assigneeEmail", e.due_at AS "dueAt", e.escalated_at AS "escalatedAt",
        e.created_at AS "createdAt", e.updated_at AS "updatedAt", i.external_reference AS reference,
        ('Excepción de conciliación · ' || replace(e.kind, '_', ' ')) AS summary, e.difference_minor::text AS "amountMinor", i.currency,
        (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = e.organization_id AND n.subject_type = 'reconciliation_exception' AND n.subject_id = e.id) AS "noteCount",
        (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = e.organization_id AND l.subject_type = 'reconciliation_exception' AND l.subject_id = e.id) AS "evidenceCount",
        jsonb_build_object('runId', e.run_id, 'itemId', e.item_id, 'transactionId', i.transaction_id,
          'kind', e.kind, 'expectedMinor', i.expected_minor::text, 'actualMinor', i.actual_minor::text) AS metadata
       FROM reconciliation_exceptions e JOIN reconciliation_items i ON i.id = e.item_id LEFT JOIN users u ON u.id = e.assigned_to
       WHERE e.organization_id = ? ORDER BY e.created_at DESC LIMIT 200`,
    ).bind(organizationId).all<WorkItemRow>(),
    database.prepare(
      `SELECT d.id, 'dispute' AS type, d.status, d.priority, d.assigned_to AS "assignedTo",
        u.display_name AS "assigneeName", u.email AS "assigneeEmail", d.due_at AS "dueAt", d.escalated_at AS "escalatedAt",
        d.created_at AS "createdAt", d.updated_at AS "updatedAt", t.counterparty AS reference,
        ('Disputa · ' || replace(d.reason, '_', ' ')) AS summary, d.amount_minor::text AS "amountMinor", d.currency,
        (SELECT COUNT(*)::int FROM operational_notes n WHERE n.organization_id = d.organization_id AND n.subject_type = 'dispute' AND n.subject_id = d.id) AS "noteCount",
        (SELECT COUNT(*)::int FROM operational_evidence_links l WHERE l.organization_id = d.organization_id AND l.subject_type = 'dispute' AND l.subject_id = d.id) AS "evidenceCount",
        jsonb_build_object('transactionId', d.transaction_id, 'reason', d.reason, 'creditStatus', d.credit_status,
          'provisionalCreditRequested', d.provisional_credit_requested = 1) AS metadata
       FROM disputes d JOIN transactions t ON t.id = d.transaction_id LEFT JOIN users u ON u.id = d.assigned_to
       WHERE d.organization_id = ? ORDER BY d.created_at DESC LIMIT 200`,
    ).bind(organizationId).all<WorkItemRow>(),
    database.prepare(
      `SELECT m.external_user_id AS "userId", u.display_name AS "displayName", m.email, m.role
       FROM members m JOIN users u ON u.id = m.external_user_id WHERE m.organization_id = ? ORDER BY u.display_name`,
    ).bind(organizationId).all<{ userId: string; displayName: string; email: string; role: string }>(),
    database.prepare(
      `SELECT id, file_name AS "fileName", content_type AS "contentType", status, created_at AS "createdAt"
       FROM compliance_documents WHERE organization_id = ? ORDER BY created_at DESC LIMIT 200`,
    ).bind(organizationId).all<{ id: string; fileName: string; contentType: string; status: string; createdAt: string }>(),
    database.prepare(
      `SELECT n.id, n.subject_type AS "subjectType", n.subject_id AS "subjectId", n.body,
        n.author_id AS "authorId", u.display_name AS "authorName", n.created_at AS "createdAt"
       FROM operational_notes n JOIN users u ON u.id = n.author_id WHERE n.organization_id = ? ORDER BY n.created_at DESC LIMIT 500`,
    ).bind(organizationId).all<Record<string, unknown>>(),
    database.prepare(
      `SELECT l.id, l.subject_type AS "subjectType", l.subject_id AS "subjectId", l.document_id AS "documentId",
        d.file_name AS "fileName", d.content_type AS "contentType", l.linked_by AS "linkedBy",
        u.display_name AS "linkedByName", l.created_at AS "createdAt"
       FROM operational_evidence_links l JOIN compliance_documents d ON d.id = l.document_id JOIN users u ON u.id = l.linked_by
       WHERE l.organization_id = ? ORDER BY l.created_at DESC LIMIT 500`,
    ).bind(organizationId).all<Record<string, unknown>>(),
  ]);
  const workItems = [...risk.results, ...reconciliation.results, ...disputes.results]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(serializeWorkItem);
  return { workItems, members: members.results, documents: documents.results, notes: notes.results, evidence: evidence.results };
}

export async function updateOperationalWorkItem(input: {
  organizationId: string; actor: AuthUser; type: WorkItemType; id: string; idempotencyKey: string;
  assignedToUserId?: string | null; priority?: WorkItemPriority; dueAt?: string | null; escalated?: boolean;
}) {
  const payload = { assignedToUserId: input.assignedToUserId, priority: input.priority, dueAt: input.dueAt, escalated: input.escalated };
  const fingerprint = await sha256(JSON.stringify({ type: input.type, id: input.id, action: 'update', payload }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:operations:${input.idempotencyKey}`).first();
    const replay = await existingAction(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (replay) return { workItem: serializeWorkItem(await requireWorkItem(database, input.organizationId, input.type, input.id)), replayed: true };
    const current = await requireWorkItem(database, input.organizationId, input.type, input.id, true);
    if (!openWorkItem(current.type, current.status)) throw new OperationsError('Sólo se pueden actualizar casos abiertos.', 409, 'work_item_closed');
    if (input.assignedToUserId) {
      const member = await database.prepare(
        `SELECT id, role FROM members WHERE organization_id = ? AND external_user_id = ? LIMIT 1`,
      ).bind(input.organizationId, input.assignedToUserId).first<{ id: string; role: string }>();
      if (!member || member.role === 'viewer') {
        throw new OperationsError('El responsable debe ser owner, admin u operator de la organización.', 400, 'invalid_assignee');
      }
    }
    const assignments: string[] = []; const values: Array<string | null> = [];
    if (input.assignedToUserId !== undefined) { assignments.push('assigned_to = ?'); values.push(input.assignedToUserId); }
    if (input.priority !== undefined) { assignments.push('priority = ?'); values.push(input.priority); }
    if (input.dueAt !== undefined) { assignments.push('due_at = ?'); values.push(input.dueAt); }
    if (input.escalated !== undefined) { assignments.push('escalated_at = ?'); values.push(input.escalated ? new Date().toISOString() : null); }
    if (assignments.length === 0) throw new OperationsError('Indicá al menos un cambio.', 400, 'empty_work_item_update');
    const now = new Date().toISOString(); assignments.push('updated_at = ?'); values.push(now);
    const table = input.type === 'risk_case' ? 'risk_cases' : input.type === 'dispute' ? 'disputes' : 'reconciliation_exceptions';
    await database.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE organization_id = ? AND id = ?`)
      .bind(...values, input.organizationId, input.id).run();
    const actionId = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO operational_actions (id, organization_id, idempotency_key, request_fingerprint, subject_type, subject_id, action, payload, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'update', ?, ?, ?)`,
    ).bind(actionId, input.organizationId, input.idempotencyKey, fingerprint, input.type, input.id, JSON.stringify(payload), input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'operations.work_item_updated',
      resourceId: input.id, payload: { type: input.type, ...payload } });
    return { workItem: serializeWorkItem(await requireWorkItem(database, input.organizationId, input.type, input.id)), replayed: false };
  });
}

export async function addOperationalNote(input: {
  organizationId: string; actor: AuthUser; type: WorkItemType; id: string; idempotencyKey: string; body: string;
}) {
  const fingerprint = await sha256(JSON.stringify({ type: input.type, id: input.id, action: 'note', body: input.body }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:operations:${input.idempotencyKey}`).first();
    const replay = await existingAction(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (replay) {
      const note = await database.prepare(
        `SELECT n.id, n.subject_type AS "subjectType", n.subject_id AS "subjectId", n.body, n.author_id AS "authorId",
          u.display_name AS "authorName", n.created_at AS "createdAt" FROM operational_notes n JOIN users u ON u.id = n.author_id WHERE n.action_id = ?`,
      ).bind(replay.id).first<Record<string, unknown>>();
      return { note, replayed: true };
    }
    await requireWorkItem(database, input.organizationId, input.type, input.id, true);
    const now = new Date().toISOString(); const actionId = crypto.randomUUID(); const noteId = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO operational_actions (id, organization_id, idempotency_key, request_fingerprint, subject_type, subject_id, action, payload, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'note', ?, ?, ?)`,
    ).bind(actionId, input.organizationId, input.idempotencyKey, fingerprint, input.type, input.id, JSON.stringify({ body: input.body }), input.actor.userId, now).run();
    await database.prepare(
      `INSERT INTO operational_notes (id, organization_id, subject_type, subject_id, body, author_id, action_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(noteId, input.organizationId, input.type, input.id, input.body, input.actor.userId, actionId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'operations.note_added',
      resourceId: input.id, payload: { type: input.type, noteId } });
    return { note: { id: noteId, subjectType: input.type, subjectId: input.id, body: input.body,
      authorId: input.actor.userId, authorName: input.actor.displayName, createdAt: now }, replayed: false };
  });
}

export async function linkOperationalEvidence(input: {
  organizationId: string; actor: AuthUser; type: WorkItemType; id: string; idempotencyKey: string; documentId: string;
}) {
  const fingerprint = await sha256(JSON.stringify({ type: input.type, id: input.id, action: 'evidence', documentId: input.documentId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:operations:${input.idempotencyKey}`).first();
    const replay = await existingAction(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (replay) {
      const evidence = await database.prepare(
        `SELECT l.id, l.subject_type AS "subjectType", l.subject_id AS "subjectId", l.document_id AS "documentId",
          d.file_name AS "fileName", d.content_type AS "contentType", l.linked_by AS "linkedBy",
          u.display_name AS "linkedByName", l.created_at AS "createdAt"
         FROM operational_evidence_links l JOIN compliance_documents d ON d.id = l.document_id JOIN users u ON u.id = l.linked_by
         WHERE l.action_id = ?`,
      ).bind(replay.id).first<Record<string, unknown>>();
      return { evidence, replayed: true };
    }
    await requireWorkItem(database, input.organizationId, input.type, input.id, true);
    const document = await database.prepare(
      `SELECT id, file_name AS "fileName", content_type AS "contentType" FROM compliance_documents
       WHERE organization_id = ? AND id = ? LIMIT 1`,
    ).bind(input.organizationId, input.documentId).first<{ id: string; fileName: string; contentType: string }>();
    if (!document) throw new OperationsError('Documento de evidencia no encontrado en la organización.', 404, 'evidence_document_not_found');
    const duplicate = await database.prepare(
      `SELECT id FROM operational_evidence_links WHERE organization_id = ? AND subject_type = ? AND subject_id = ? AND document_id = ? LIMIT 1`,
    ).bind(input.organizationId, input.type, input.id, input.documentId).first<{ id: string }>();
    if (duplicate) throw new OperationsError('El documento ya está vinculado al caso.', 409, 'evidence_already_linked');
    const now = new Date().toISOString(); const actionId = crypto.randomUUID(); const linkId = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO operational_actions (id, organization_id, idempotency_key, request_fingerprint, subject_type, subject_id, action, payload, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'evidence', ?, ?, ?)`,
    ).bind(actionId, input.organizationId, input.idempotencyKey, fingerprint, input.type, input.id, JSON.stringify({ documentId: input.documentId }), input.actor.userId, now).run();
    await database.prepare(
      `INSERT INTO operational_evidence_links (id, organization_id, subject_type, subject_id, document_id, linked_by, action_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(linkId, input.organizationId, input.type, input.id, input.documentId, input.actor.userId, actionId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'operations.evidence_linked',
      resourceId: input.id, payload: { type: input.type, documentId: input.documentId, linkId } });
    return { evidence: { id: linkId, subjectType: input.type, subjectId: input.id, documentId: input.documentId,
      fileName: document.fileName, contentType: document.contentType, linkedBy: input.actor.userId,
      linkedByName: input.actor.displayName, createdAt: now }, replayed: false };
  });
}
