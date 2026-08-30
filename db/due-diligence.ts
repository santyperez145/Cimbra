import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import type { OrganizationRole } from '@/app/lib/platform/access-policy';
import type { DueDiligenceCheckType, DueDiligenceRiskRating } from '@/app/lib/platform/due-diligence-input';
import { type DatabaseClient, getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';

export type DueDiligenceKind = 'kyc' | 'kyb';
export type DueDiligenceStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'expired';

type CaseRow = {
  id: string; customerId: string; customerName: string; customerType: 'individual' | 'business'; country: string; taxIdLast4: string;
  idempotencyKey: string; requestFingerprint: string; kind: DueDiligenceKind; jurisdiction: string; policyVersion: string;
  requiredChecks: string; status: DueDiligenceStatus; riskRating: 'unassessed' | DueDiligenceRiskRating; expiresAt: string;
  createdBy: string; createdByName: string; submittedBy: string | null; submittedByName: string | null; submittedAt: string | null;
  resolvedBy: string | null; resolvedByName: string | null; resolutionNote: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string;
};

type PartyRow = {
  id: string; caseId: string; role: 'subject' | 'legal_representative' | 'beneficial_owner' | 'director';
  name: string; taxIdLast4: string; ownershipBps: number | null; pepDeclared: number; createdBy: string; createdByName: string; createdAt: string;
};

type CheckRow = {
  id: string; caseId: string; checkType: DueDiligenceCheckType; source: 'manual_review' | 'official_registry' | 'internal_list';
  status: 'pending' | 'passed' | 'failed' | 'review'; resultCode: string; note: string; evidenceDocumentId: string | null;
  evidenceFileName: string | null; checkedBy: string; checkedByName: string; createdAt: string;
};

type EventRow = {
  id: string; caseId: string; event: 'created' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  fromStatus: DueDiligenceStatus | null; toStatus: DueDiligenceStatus; payload: string; actorId: string; actorName: string; createdAt: string;
};

const POLICY_VERSION = 'cimbra-cdd-2026-08';
const KYC_CHECKS: DueDiligenceCheckType[] = ['identity_document', 'address', 'sanctions', 'pep'];
const KYB_CHECKS: DueDiligenceCheckType[] = ['business_registry', 'sanctions', 'pep', 'beneficial_ownership'];

export class DueDiligenceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'due_diligence_error') { super(message); }
}

const caseSelect = `SELECT c.id, c.customer_id AS "customerId", customer.name AS "customerName", customer.type AS "customerType",
  customer.country, customer.tax_id_last4 AS "taxIdLast4", c.idempotency_key AS "idempotencyKey",
  c.request_fingerprint AS "requestFingerprint", c.kind, c.jurisdiction, c.policy_version AS "policyVersion",
  c.required_checks AS "requiredChecks", c.status, c.risk_rating AS "riskRating", c.expires_at AS "expiresAt",
  c.created_by AS "createdBy", creator.display_name AS "createdByName", c.submitted_by AS "submittedBy",
  submitter.display_name AS "submittedByName", c.submitted_at AS "submittedAt", c.resolved_by AS "resolvedBy",
  resolver.display_name AS "resolvedByName", c.resolution_note AS "resolutionNote", c.resolved_at AS "resolvedAt",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM due_diligence_cases c JOIN customers customer ON customer.id = c.customer_id
  JOIN users creator ON creator.id = c.created_by LEFT JOIN users submitter ON submitter.id = c.submitted_by
  LEFT JOIN users resolver ON resolver.id = c.resolved_by`;

function parseJsonArray(value: string): DueDiligenceCheckType[] {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed as DueDiligenceCheckType[] : []; }
  catch { return []; }
}

function parsePayload(value: string) {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function publicParty(row: PartyRow) {
  const { ownershipBps, ...safe } = row;
  return { ...safe, ownershipPercentage: ownershipBps === null ? null : ownershipBps / 100, pepDeclared: row.pepDeclared === 1 };
}

function publicCase(row: CaseRow, parties: PartyRow[] = [], checks: CheckRow[] = [], events: EventRow[] = []) {
  const requiredChecks = parseJsonArray(row.requiredChecks);
  const latestChecks = new Map<DueDiligenceCheckType, CheckRow>();
  for (const check of checks) if (!latestChecks.has(check.checkType)) latestChecks.set(check.checkType, check);
  const completedRequiredChecks = requiredChecks.filter((type) => {
    const check = latestChecks.get(type); return check && check.status !== 'pending';
  }).length;
  const { idempotencyKey, requestFingerprint, requiredChecks: storedChecks, ...safe } = row;
  void idempotencyKey; void requestFingerprint; void storedChecks;
  return {
    ...safe, requiredChecks, completedRequiredChecks,
    readyForReview: completedRequiredChecks === requiredChecks.length && (row.kind === 'kyc' ||
      (parties.some((party) => party.role === 'legal_representative') && parties.some((party) => party.role === 'beneficial_owner'))),
    parties: parties.map(publicParty), checks, events: events.map((event) => ({ ...event, payload: parsePayload(event.payload) })),
  };
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, 'due_diligence_case', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceId,
    JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: 'due_diligence_case', resourceId: input.resourceId, data: input.payload });
}

async function addEvent(database: DatabaseClient, input: {
  organizationId: string; caseId: string; idempotencyKey: string; requestFingerprint: string;
  event: EventRow['event']; fromStatus: DueDiligenceStatus | null; toStatus: DueDiligenceStatus;
  actorId: string; payload?: Record<string, unknown>; createdAt?: string;
}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  await database.prepare(
    `INSERT INTO due_diligence_events
      (id, organization_id, case_id, idempotency_key, request_fingerprint, event, from_status, to_status, payload, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.caseId, input.idempotencyKey, input.requestFingerprint,
    input.event, input.fromStatus, input.toStatus, JSON.stringify(input.payload ?? {}), input.actorId, createdAt).run();
  await audit(database, { organizationId: input.organizationId, actorId: input.actorId,
    action: `due_diligence.${input.event}`, resourceId: input.caseId, payload: input.payload });
}

async function loadCase(database: DatabaseClient, organizationId: string, caseId: string, lock = false) {
  return database.prepare(`${caseSelect} WHERE c.organization_id = ? AND c.id = ?${lock ? ' FOR UPDATE OF c' : ''}`)
    .bind(organizationId, caseId).first<CaseRow>();
}

async function loadCaseRelations(database: DatabaseClient, organizationId: string, caseIds: string[]) {
  if (!caseIds.length) return { parties: [] as PartyRow[], checks: [] as CheckRow[], events: [] as EventRow[] };
  const placeholders = caseIds.map(() => '?').join(', ');
  const [parties, checks, events] = await Promise.all([
    database.prepare(
      `SELECT p.id, p.case_id AS "caseId", p.role, p.name, p.tax_id_last4 AS "taxIdLast4", p.ownership_bps AS "ownershipBps",
        p.pep_declared AS "pepDeclared", p.created_by AS "createdBy", u.display_name AS "createdByName", p.created_at AS "createdAt"
       FROM due_diligence_parties p JOIN users u ON u.id = p.created_by
       WHERE p.organization_id = ? AND p.case_id IN (${placeholders}) ORDER BY p.created_at ASC`,
    ).bind(organizationId, ...caseIds).all<PartyRow>(),
    database.prepare(
      `SELECT d.id, d.case_id AS "caseId", d.check_type AS "checkType", d.source, d.status, d.result_code AS "resultCode",
        d.note, d.evidence_document_id AS "evidenceDocumentId", document.file_name AS "evidenceFileName",
        d.checked_by AS "checkedBy", u.display_name AS "checkedByName", d.created_at AS "createdAt"
       FROM due_diligence_checks d JOIN users u ON u.id = d.checked_by
       LEFT JOIN compliance_documents document ON document.id = d.evidence_document_id
       WHERE d.organization_id = ? AND d.case_id IN (${placeholders}) ORDER BY d.created_at DESC, d.id DESC`,
    ).bind(organizationId, ...caseIds).all<CheckRow>(),
    database.prepare(
      `SELECT e.id, e.case_id AS "caseId", e.event, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.payload,
        e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt"
       FROM due_diligence_events e JOIN users u ON u.id = e.actor_id
       WHERE e.organization_id = ? AND e.case_id IN (${placeholders}) ORDER BY e.created_at DESC`,
    ).bind(organizationId, ...caseIds).all<EventRow>(),
  ]);
  return { parties: parties.results, checks: checks.results, events: events.results };
}

async function hydratedCase(database: DatabaseClient, organizationId: string, caseId: string) {
  const row = await loadCase(database, organizationId, caseId);
  if (!row) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
  const relations = await loadCaseRelations(database, organizationId, [caseId]);
  return publicCase(row, relations.parties, relations.checks, relations.events);
}

async function priorEvent(database: DatabaseClient, organizationId: string, idempotencyKey: string, fingerprint: string) {
  const event = await database.prepare(
    `SELECT case_id AS "caseId", request_fingerprint AS "requestFingerprint" FROM due_diligence_events
     WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(organizationId, idempotencyKey).first<{ caseId: string; requestFingerprint: string }>();
  if (event && event.requestFingerprint !== fingerprint) {
    throw new DueDiligenceError('La Idempotency-Key ya fue usada con otra acción.', 409, 'idempotency_mismatch');
  }
  return event;
}

export async function expireDueDiligenceCases(limit = 100, organizationId?: string) {
  return getDatabaseClient().transaction(async (database) => {
    const now = new Date().toISOString();
    const filter = organizationId ? ' AND organization_id = ?' : '';
    const parameters: Array<string | number> = [now];
    if (organizationId) parameters.push(organizationId);
    parameters.push(Math.min(Math.max(limit, 1), 500), now);
    const expired = await database.prepare(
      `WITH candidates AS (
         SELECT id, status FROM due_diligence_cases WHERE status IN ('draft', 'in_review') AND expires_at <= ?${filter}
         ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT ?
       )
       UPDATE due_diligence_cases c SET status = 'expired', updated_at = ? FROM candidates WHERE c.id = candidates.id
       RETURNING c.id, c.organization_id AS "organizationId", candidates.status AS "fromStatus", c.created_by AS "createdBy"`,
    ).bind(...parameters).all<{ id: string; organizationId: string; fromStatus: DueDiligenceStatus; createdBy: string }>();
    for (const item of expired.results) {
      const fingerprint = await sha256(JSON.stringify({ caseId: item.id, event: 'expired', automatic: true }));
      await addEvent(database, { organizationId: item.organizationId, caseId: item.id, idempotencyKey: `expiry:${item.id}`,
        requestFingerprint: fingerprint, event: 'expired', fromStatus: item.fromStatus, toStatus: 'expired', actorId: item.createdBy,
        payload: { automatic: true }, createdAt: now });
    }
    return expired.results.length;
  });
}

export async function listDueDiligenceState(organizationId: string) {
  await expireDueDiligenceCases(100, organizationId);
  const database = getDatabaseClient();
  const [cases, customers, documents] = await Promise.all([
    database.prepare(`${caseSelect} WHERE c.organization_id = ? ORDER BY c.created_at DESC LIMIT 100`).bind(organizationId).all<CaseRow>(),
    database.prepare(
      `SELECT id, type, name, country, tax_id_last4 AS "taxIdLast4", status, created_at AS "createdAt"
       FROM customers WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(organizationId).all<Record<string, unknown>>(),
    database.prepare(
      `SELECT id, file_name AS "fileName", content_type AS "contentType", size, status, created_at AS "createdAt"
       FROM compliance_documents WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(organizationId).all<Record<string, unknown>>(),
  ]);
  const relations = await loadCaseRelations(database, organizationId, cases.results.map((item) => item.id));
  const serialized = cases.results.map((item) => publicCase(item,
    relations.parties.filter((party) => party.caseId === item.id), relations.checks.filter((check) => check.caseId === item.id),
    relations.events.filter((event) => event.caseId === item.id)));
  return {
    policy: { version: POLICY_VERSION, kycRequiredChecks: KYC_CHECKS, kybRequiredChecks: KYB_CHECKS,
      boundary: 'La orquestación registra evidencia y decisiones; no sustituye validación biométrica, consulta oficial ni aprobación regulatoria.' },
    metrics: {
      total: serialized.length, drafts: serialized.filter((item) => item.status === 'draft').length,
      inReview: serialized.filter((item) => item.status === 'in_review').length,
      approved: serialized.filter((item) => item.status === 'approved').length,
      rejected: serialized.filter((item) => item.status === 'rejected').length,
    }, cases: serialized, customers: customers.results, documents: documents.results,
  };
}

export async function retrieveDueDiligenceCase(organizationId: string, caseId: string) {
  await expireDueDiligenceCases(100, organizationId);
  const database = getDatabaseClient();
  return hydratedCase(database, organizationId, caseId);
}

export async function createDueDiligenceCase(input: {
  organizationId: string; actor: AuthUser; customerId: string; expiresInDays: number; idempotencyKey: string;
}) {
  const fingerprint = await sha256(JSON.stringify({ customerId: input.customerId, expiresInDays: input.expiresInDays }));
  await expireDueDiligenceCases(100, input.organizationId);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.customerId}`).first();
    const existing = await database.prepare(`${caseSelect} WHERE c.organization_id = ? AND c.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<CaseRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new DueDiligenceError('La Idempotency-Key ya fue usada con otro expediente.', 409, 'idempotency_mismatch');
      return { case: await hydratedCase(database, input.organizationId, existing.id), replayed: true };
    }
    const customer = await database.prepare(
      `SELECT id, type, country FROM customers WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.customerId, input.organizationId).first<{ id: string; type: 'individual' | 'business'; country: string }>();
    if (!customer) throw new DueDiligenceError('Cliente no encontrado en la organización.', 404, 'customer_not_found');
    const now = new Date().toISOString();
    const active = await database.prepare(
      `SELECT id FROM due_diligence_cases WHERE organization_id = ? AND customer_id = ? AND status IN ('draft', 'in_review')
       AND expires_at > ? LIMIT 1`,
    ).bind(input.organizationId, input.customerId, now).first<{ id: string }>();
    if (active) throw new DueDiligenceError('El cliente ya tiene un expediente activo.', 409, 'due_diligence_case_active');
    const id = crypto.randomUUID();
    const kind: DueDiligenceKind = customer.type === 'business' ? 'kyb' : 'kyc';
    const requiredChecks = kind === 'kyb' ? KYB_CHECKS : KYC_CHECKS;
    const expiresAt = new Date(Date.parse(now) + input.expiresInDays * 86_400_000).toISOString();
    await database.prepare(
      `INSERT INTO due_diligence_cases
        (id, organization_id, customer_id, idempotency_key, request_fingerprint, kind, jurisdiction, policy_version,
         required_checks, status, risk_rating, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unassessed', ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, customer.id, input.idempotencyKey, fingerprint, kind, customer.country,
      POLICY_VERSION, JSON.stringify(requiredChecks), expiresAt, input.actor.userId, now, now).run();
    await addEvent(database, { organizationId: input.organizationId, caseId: id, idempotencyKey: `case-created:${input.idempotencyKey}`,
      requestFingerprint: fingerprint, event: 'created', fromStatus: null, toStatus: 'draft', actorId: input.actor.userId,
      payload: { customerId: customer.id, kind, jurisdiction: customer.country, policyVersion: POLICY_VERSION, requiredChecks, expiresAt }, createdAt: now });
    const created = await loadCase(database, input.organizationId, id);
    if (!created) throw new DueDiligenceError('No pudimos recuperar el expediente.', 500, 'due_diligence_case_create_failed');
    return { case: publicCase(created), replayed: false };
  });
}

export async function addDueDiligenceParty(input: {
  organizationId: string; actor: AuthUser; caseId: string; idempotencyKey: string;
  role: PartyRow['role']; name: string; taxIdLast4: string; ownershipBps: number | null; pepDeclared: boolean;
}) {
  const fingerprint = await sha256(JSON.stringify({ caseId: input.caseId, role: input.role, name: input.name,
    taxIdLast4: input.taxIdLast4, ownershipBps: input.ownershipBps, pepDeclared: input.pepDeclared }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.caseId}`).first();
    const existing = await database.prepare(
      `SELECT p.id, p.case_id AS "caseId", p.role, p.name, p.tax_id_last4 AS "taxIdLast4", p.ownership_bps AS "ownershipBps",
        p.pep_declared AS "pepDeclared", p.created_by AS "createdBy", u.display_name AS "createdByName", p.created_at AS "createdAt",
        p.request_fingerprint AS "requestFingerprint" FROM due_diligence_parties p JOIN users u ON u.id = p.created_by
       WHERE p.organization_id = ? AND p.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<PartyRow & { requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new DueDiligenceError('La Idempotency-Key ya fue usada con otra parte.', 409, 'idempotency_mismatch');
      return { party: publicParty(existing), replayed: true };
    }
    const dueCase = await loadCase(database, input.organizationId, input.caseId, true);
    if (!dueCase) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
    if (dueCase.status !== 'draft') throw new DueDiligenceError('Sólo un expediente draft admite nuevas partes.', 409, 'due_diligence_case_not_draft');
    if ((dueCase.kind === 'kyc' && input.role !== 'subject') || (dueCase.kind === 'kyb' && input.role === 'subject')) {
      throw new DueDiligenceError('El rol no corresponde al tipo de expediente.', 409, 'due_diligence_party_role_invalid');
    }
    if (input.role === 'beneficial_owner') {
      const ownership = await database.prepare(
        `SELECT COALESCE(SUM(ownership_bps), 0)::int AS total FROM due_diligence_parties
         WHERE organization_id = ? AND case_id = ? AND role = 'beneficial_owner'`,
      ).bind(input.organizationId, input.caseId).first<{ total: number }>();
      if (Number(ownership?.total ?? 0) + Number(input.ownershipBps ?? 0) > 10_000) {
        throw new DueDiligenceError('La participación declarada supera el 100%.', 409, 'due_diligence_ownership_exceeded');
      }
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO due_diligence_parties
        (id, organization_id, case_id, idempotency_key, request_fingerprint, role, name, tax_id_last4,
         ownership_bps, pep_declared, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, input.caseId, input.idempotencyKey, fingerprint, input.role, input.name,
      input.taxIdLast4, input.ownershipBps, input.pepDeclared ? 1 : 0, input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'due_diligence.party_added', resourceId: input.caseId,
      payload: { partyId: id, role: input.role, taxIdLast4: input.taxIdLast4, ownershipBps: input.ownershipBps,
        pepDeclared: input.pepDeclared } });
    return { party: { id, caseId: input.caseId, role: input.role, name: input.name, taxIdLast4: input.taxIdLast4,
      ownershipPercentage: input.ownershipBps === null ? null : input.ownershipBps / 100,
      pepDeclared: input.pepDeclared, createdBy: input.actor.userId, createdByName: input.actor.displayName, createdAt: now }, replayed: false };
  });
}

export async function recordDueDiligenceCheck(input: {
  organizationId: string; actor: AuthUser; caseId: string; idempotencyKey: string; checkType: DueDiligenceCheckType;
  source: CheckRow['source']; status: CheckRow['status']; resultCode: string; note: string; evidenceDocumentId: string | null;
}) {
  const fingerprint = await sha256(JSON.stringify({ caseId: input.caseId, checkType: input.checkType, source: input.source,
    status: input.status, resultCode: input.resultCode, note: input.note, evidenceDocumentId: input.evidenceDocumentId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.caseId}`).first();
    const existing = await database.prepare(
      `SELECT d.id, d.case_id AS "caseId", d.check_type AS "checkType", d.source, d.status, d.result_code AS "resultCode", d.note,
        d.evidence_document_id AS "evidenceDocumentId", document.file_name AS "evidenceFileName", d.checked_by AS "checkedBy",
        u.display_name AS "checkedByName", d.created_at AS "createdAt", d.request_fingerprint AS "requestFingerprint"
       FROM due_diligence_checks d JOIN users u ON u.id = d.checked_by LEFT JOIN compliance_documents document ON document.id = d.evidence_document_id
       WHERE d.organization_id = ? AND d.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<CheckRow & { requestFingerprint: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new DueDiligenceError('La Idempotency-Key ya fue usada con otro check.', 409, 'idempotency_mismatch');
      const { requestFingerprint, ...check } = existing; void requestFingerprint;
      return { check, replayed: true };
    }
    const dueCase = await loadCase(database, input.organizationId, input.caseId, true);
    if (!dueCase) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
    if (dueCase.status !== 'draft') throw new DueDiligenceError('Sólo un expediente draft admite nuevos checks.', 409, 'due_diligence_case_not_draft');
    let evidenceFileName: string | null = null;
    if (input.evidenceDocumentId) {
      const document = await database.prepare(
        `SELECT file_name AS "fileName" FROM compliance_documents WHERE id = ? AND organization_id = ? LIMIT 1`,
      ).bind(input.evidenceDocumentId, input.organizationId).first<{ fileName: string }>();
      if (!document) throw new DueDiligenceError('Documento de evidencia no encontrado.', 404, 'due_diligence_document_not_found');
      evidenceFileName = document.fileName;
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO due_diligence_checks
        (id, organization_id, case_id, idempotency_key, request_fingerprint, check_type, source, status,
         result_code, note, evidence_document_id, checked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, input.caseId, input.idempotencyKey, fingerprint, input.checkType, input.source,
      input.status, input.resultCode, input.note, input.evidenceDocumentId, input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: 'due_diligence.check_recorded', resourceId: input.caseId,
      payload: { checkId: id, checkType: input.checkType, source: input.source, status: input.status,
        resultCode: input.resultCode, evidenceDocumentId: input.evidenceDocumentId } });
    return { check: { id, caseId: input.caseId, checkType: input.checkType, source: input.source, status: input.status,
      resultCode: input.resultCode, note: input.note, evidenceDocumentId: input.evidenceDocumentId, evidenceFileName,
      checkedBy: input.actor.userId, checkedByName: input.actor.displayName, createdAt: now }, replayed: false };
  });
}

async function caseReadiness(database: DatabaseClient, organizationId: string, dueCase: CaseRow) {
  const requiredChecks = parseJsonArray(dueCase.requiredChecks);
  const latest = await database.prepare(
    `SELECT DISTINCT ON (check_type) check_type AS "checkType", status FROM due_diligence_checks
     WHERE organization_id = ? AND case_id = ? ORDER BY check_type, created_at DESC, id DESC`,
  ).bind(organizationId, dueCase.id).all<{ checkType: DueDiligenceCheckType; status: CheckRow['status'] }>();
  const missing = requiredChecks.filter((type) => !latest.results.some((check) => check.checkType === type && check.status !== 'pending'));
  const nonPassing = requiredChecks.filter((type) => !latest.results.some((check) => check.checkType === type && check.status === 'passed'));
  const parties = await database.prepare(
    `SELECT role FROM due_diligence_parties WHERE organization_id = ? AND case_id = ?`,
  ).bind(organizationId, dueCase.id).all<{ role: PartyRow['role'] }>();
  const missingParties = dueCase.kind === 'kyb' ? [
    ...(parties.results.some((party) => party.role === 'legal_representative') ? [] : ['legal_representative']),
    ...(parties.results.some((party) => party.role === 'beneficial_owner') ? [] : ['beneficial_owner']),
  ] : [];
  return { missing, nonPassing, missingParties };
}

export async function submitDueDiligenceCase(input: {
  organizationId: string; actor: AuthUser; caseId: string; idempotencyKey: string;
}) {
  const fingerprint = await sha256(JSON.stringify({ caseId: input.caseId, event: 'submitted' }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.caseId}`).first();
    const prior = await priorEvent(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (prior) return { case: await hydratedCase(database, input.organizationId, prior.caseId), replayed: true };
    const dueCase = await loadCase(database, input.organizationId, input.caseId, true);
    if (!dueCase) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
    if (dueCase.status !== 'draft') throw new DueDiligenceError('El expediente ya no está en draft.', 409, 'due_diligence_case_not_draft');
    const now = new Date().toISOString();
    if (dueCase.expiresAt <= now) throw new DueDiligenceError('El expediente está vencido.', 409, 'due_diligence_case_expired');
    const readiness = await caseReadiness(database, input.organizationId, dueCase);
    if (readiness.missing.length || readiness.missingParties.length) {
      throw new DueDiligenceError(`Faltan requisitos: ${[...readiness.missing, ...readiness.missingParties].join(', ')}.`,
        409, 'due_diligence_requirements_missing');
    }
    await database.prepare(
      `UPDATE due_diligence_cases SET status = 'in_review', submitted_by = ?, submitted_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(input.actor.userId, now, now, input.caseId).run();
    await addEvent(database, { organizationId: input.organizationId, caseId: input.caseId, idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, event: 'submitted', fromStatus: 'draft', toStatus: 'in_review', actorId: input.actor.userId,
      payload: { missingChecks: [], nonPassingChecks: readiness.nonPassing, policyVersion: dueCase.policyVersion }, createdAt: now });
    return { case: await hydratedCase(database, input.organizationId, input.caseId), replayed: false };
  });
}

export async function decideDueDiligenceCase(input: {
  organizationId: string; actor: AuthUser; actorRole: OrganizationRole | 'api_key'; caseId: string; idempotencyKey: string;
  decision: 'approve' | 'reject'; riskRating: DueDiligenceRiskRating; note: string;
}) {
  if (!['owner', 'admin'].includes(input.actorRole) || !input.actor.mfaEnabled) {
    throw new DueDiligenceError('La decisión requiere owner/admin con MFA.', 403, 'due_diligence_checker_required');
  }
  const fingerprint = await sha256(JSON.stringify({ caseId: input.caseId, decision: input.decision,
    riskRating: input.riskRating, note: input.note }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.caseId}`).first();
    const prior = await priorEvent(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (prior) return { case: await hydratedCase(database, input.organizationId, prior.caseId), replayed: true };
    const dueCase = await loadCase(database, input.organizationId, input.caseId, true);
    if (!dueCase) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
    if (dueCase.status !== 'in_review') throw new DueDiligenceError('El expediente no está en revisión.', 409, 'due_diligence_case_not_in_review');
    if (dueCase.submittedBy === input.actor.userId) {
      throw new DueDiligenceError('El maker no puede decidir su propio expediente.', 409, 'due_diligence_self_decision');
    }
    const readiness = await caseReadiness(database, input.organizationId, dueCase);
    if (input.decision === 'approve' && (readiness.nonPassing.length || readiness.missingParties.length)) {
      throw new DueDiligenceError(`No se puede aprobar: ${[...readiness.nonPassing, ...readiness.missingParties].join(', ')}.`,
        409, 'due_diligence_approval_blocked');
    }
    const now = new Date().toISOString(); const status = input.decision === 'approve' ? 'approved' : 'rejected';
    await database.prepare(
      `UPDATE due_diligence_cases SET status = ?, risk_rating = ?, resolved_by = ?, resolution_note = ?,
        resolved_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(status, input.riskRating, input.actor.userId, input.note, now, now, input.caseId).run();
    await addEvent(database, { organizationId: input.organizationId, caseId: input.caseId, idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, event: status, fromStatus: 'in_review', toStatus: status, actorId: input.actor.userId,
      payload: { decision: input.decision, riskRating: input.riskRating, note: input.note,
        nonPassingChecks: readiness.nonPassing }, createdAt: now });
    return { case: await hydratedCase(database, input.organizationId, input.caseId), replayed: false };
  });
}

export async function cancelDueDiligenceCase(input: {
  organizationId: string; actor: AuthUser; caseId: string; idempotencyKey: string; note: string;
}) {
  const fingerprint = await sha256(JSON.stringify({ caseId: input.caseId, event: 'cancelled', note: input.note }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:due-diligence:${input.caseId}`).first();
    const prior = await priorEvent(database, input.organizationId, input.idempotencyKey, fingerprint);
    if (prior) return { case: await hydratedCase(database, input.organizationId, prior.caseId), replayed: true };
    const dueCase = await loadCase(database, input.organizationId, input.caseId, true);
    if (!dueCase) throw new DueDiligenceError('Expediente no encontrado.', 404, 'due_diligence_case_not_found');
    if (!['draft', 'in_review'].includes(dueCase.status)) throw new DueDiligenceError('El expediente ya es terminal.', 409, 'due_diligence_case_terminal');
    const now = new Date().toISOString();
    await database.prepare(`UPDATE due_diligence_cases SET status = 'cancelled', resolved_by = ?, resolution_note = ?,
      resolved_at = ?, updated_at = ? WHERE id = ?`).bind(input.actor.userId, input.note, now, now, input.caseId).run();
    await addEvent(database, { organizationId: input.organizationId, caseId: input.caseId, idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint, event: 'cancelled', fromStatus: dueCase.status, toStatus: 'cancelled', actorId: input.actor.userId,
      payload: { note: input.note }, createdAt: now });
    return { case: await hydratedCase(database, input.organizationId, input.caseId), replayed: false };
  });
}
