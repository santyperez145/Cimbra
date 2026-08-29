import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import { systemAmountRisk } from '@/app/lib/platform/risk-engine';
import { enqueueWebhookEvent } from './platform';
import { type DatabaseClient, getDatabaseClient } from './client';

export type RiskOperation = 'transfer' | 'cash_in' | 'cash_out';
export type RiskDecision = 'approve' | 'review' | 'decline';
export type RiskRuleKind = 'amount_threshold' | 'velocity_count' | 'counterparty_match';
export type RiskRuleAction = 'score' | 'review' | 'decline';

type StoredEvaluation = {
  id: string; operationType: RiskOperation; resourceType: string; resourceId: string | null; amountMinor: string; currency: Currency;
  counterparty: string; score: number; decision: RiskDecision; matchedRuleIds: string; reasons: string; createdAt: string; requestFingerprint: string;
};

export type RiskAssessment = {
  id?: string;
  operationType: RiskOperation;
  resourceType: string;
  resourceId: string | null;
  amountMinor: string;
  amount: number;
  currency: Currency;
  counterparty: string;
  score: number;
  decision: RiskDecision;
  matchedRuleIds: string[];
  reasons: string[];
  createdAt?: string;
  requestFingerprint: string;
  replayed: boolean;
};

export class RiskError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'risk_error') { super(message); }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function parseConfiguration(value: string) {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function serializeEvaluation(row: StoredEvaluation, replayed: boolean): RiskAssessment {
  return {
    id: row.id, operationType: row.operationType, resourceType: row.resourceType, resourceId: row.resourceId,
    amountMinor: row.amountMinor, amount: minorToMajorNumber(row.amountMinor, row.currency), currency: row.currency,
    counterparty: row.counterparty, score: row.score, decision: row.decision,
    matchedRuleIds: parseStringArray(row.matchedRuleIds), reasons: parseStringArray(row.reasons), createdAt: row.createdAt,
    requestFingerprint: row.requestFingerprint, replayed,
  };
}

async function assessmentFingerprint(input: {
  operationType: RiskOperation; amountMinor: bigint; currency: Currency; counterparty: string;
}) {
  return sha256(JSON.stringify({ operationType: input.operationType, amountMinor: input.amountMinor.toString(), currency: input.currency, counterparty: input.counterparty }));
}

export async function assessRisk(input: {
  organizationId: string;
  idempotencyKey: string;
  operationType: RiskOperation;
  amountMinor: bigint;
  currency: Currency;
  counterparty: string;
}, database: DatabaseClient = getDatabaseClient()): Promise<RiskAssessment> {
  const fingerprint = await assessmentFingerprint(input);
  const existing = await database.prepare(
    `SELECT id, operation_type AS "operationType", resource_type AS "resourceType", resource_id AS "resourceId",
      amount_minor::text AS "amountMinor", currency, counterparty, score, decision,
      matched_rule_ids AS "matchedRuleIds", reasons, created_at AS "createdAt", request_fingerprint AS "requestFingerprint"
     FROM risk_evaluations WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, input.idempotencyKey).first<StoredEvaluation>();
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya fue usada con otra evaluación.', 409, 'idempotency_mismatch');
    return serializeEvaluation(existing, true);
  }

  let score = 7;
  let forceReview = false;
  let forceDecline = false;
  const matchedRuleIds: string[] = [];
  const reasons: string[] = [];
  const amountRisk = systemAmountRisk(input.amountMinor, input.currency);
  score += amountRisk.scoreDelta; forceReview ||= amountRisk.forceReview;
  if (amountRisk.ruleId && amountRisk.reason) { matchedRuleIds.push(amountRisk.ruleId); reasons.push(amountRisk.reason); }
  const velocity = await database.prepare(
    `SELECT COUNT(*)::int AS count FROM transactions
     WHERE organization_id = ? AND lower(counterparty) = lower(?) AND created_at >= ?`,
  ).bind(input.organizationId, input.counterparty, new Date(Date.now() - 60 * 60 * 1000).toISOString()).first<{ count: number }>();
  if (Number(velocity?.count ?? 0) >= 4) {
    score += 35; forceReview = true; matchedRuleIds.push('sys_velocity_counterparty'); reasons.push('counterparty_velocity');
  }

  const rules = await database.prepare(
    `SELECT id, name, kind, operation_type AS "operationType", score_delta AS "scoreDelta", action, configuration
     FROM risk_rules WHERE organization_id = ? AND status = 'active' AND operation_type IN ('any', ?)
     ORDER BY priority ASC, created_at ASC`,
  ).bind(input.organizationId, input.operationType).all<{
    id: string; name: string; kind: RiskRuleKind; operationType: string; scoreDelta: number; action: RiskRuleAction; configuration: string;
  }>();
  for (const rule of rules.results) {
    const configuration = parseConfiguration(rule.configuration);
    let matches = false;
    if (rule.kind === 'amount_threshold') {
      const configuredCurrency = typeof configuration.currency === 'string' ? configuration.currency : input.currency;
      const thresholdMinor = typeof configuration.thresholdMinor === 'string' && /^\d+$/.test(configuration.thresholdMinor)
        ? BigInt(configuration.thresholdMinor) : null;
      matches = configuredCurrency === input.currency && thresholdMinor !== null && input.amountMinor >= thresholdMinor;
    } else if (rule.kind === 'counterparty_match') {
      const pattern = typeof configuration.pattern === 'string' ? configuration.pattern.toLowerCase() : '';
      matches = pattern.length >= 2 && input.counterparty.toLowerCase().includes(pattern);
    } else if (rule.kind === 'velocity_count') {
      const count = Number(configuration.count);
      const windowMinutes = Number(configuration.windowMinutes);
      if (Number.isInteger(count) && count > 0 && Number.isInteger(windowMinutes) && windowMinutes > 0) {
        const result = await database.prepare(
          `SELECT COUNT(*)::int AS count FROM transactions WHERE organization_id = ? AND created_at >= ?`,
        ).bind(input.organizationId, new Date(Date.now() - windowMinutes * 60_000).toISOString()).first<{ count: number }>();
        matches = Number(result?.count ?? 0) + 1 >= count;
      }
    }
    if (!matches) continue;
    score += rule.scoreDelta;
    matchedRuleIds.push(rule.id);
    reasons.push(`rule:${rule.name}`);
    if (rule.action === 'review') forceReview = true;
    if (rule.action === 'decline') forceDecline = true;
  }
  score = Math.min(100, Math.max(0, score));
  const decision: RiskDecision = forceDecline ? 'decline' : forceReview || score >= 60 ? 'review' : 'approve';
  return {
    operationType: input.operationType, resourceType: 'transaction', resourceId: null,
    amountMinor: input.amountMinor.toString(), amount: minorToMajorNumber(input.amountMinor, input.currency), currency: input.currency,
    counterparty: input.counterparty, score, decision, matchedRuleIds, reasons, requestFingerprint: fingerprint, replayed: false,
  };
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

export async function persistRiskAssessment(input: {
  organizationId: string; idempotencyKey: string; actor: AuthUser; assessment: RiskAssessment; resourceId?: string | null; holdId?: string | null;
}, database: DatabaseClient = getDatabaseClient()) {
  if (input.assessment.replayed && input.assessment.id) return input.assessment;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO risk_evaluations
      (id, organization_id, idempotency_key, request_fingerprint, operation_type, resource_type, resource_id,
       amount_minor, currency, counterparty, score, decision, matched_rule_ids, reasons, created_at)
     VALUES (?, ?, ?, ?, ?, 'transaction', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
  ).bind(id, input.organizationId, input.idempotencyKey, input.assessment.requestFingerprint, input.assessment.operationType,
    input.resourceId ?? null, input.assessment.amountMinor, input.assessment.currency, input.assessment.counterparty,
    input.assessment.score, input.assessment.decision, JSON.stringify(input.assessment.matchedRuleIds), JSON.stringify(input.assessment.reasons), now).run();
  if (input.assessment.decision !== 'approve') {
    const caseId = crypto.randomUUID();
    const priority = input.assessment.decision === 'decline' || input.assessment.score >= 85 ? 'critical' : input.assessment.score >= 70 ? 'high' : 'medium';
    const dueHours = priority === 'critical' ? 1 : priority === 'high' ? 4 : 24;
    const dueAt = new Date(Date.parse(now) + dueHours * 60 * 60 * 1000).toISOString();
    await database.prepare(
      `INSERT INTO risk_cases
        (id, organization_id, evaluation_id, transaction_id, hold_id, status, priority, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?) ON CONFLICT (evaluation_id) DO NOTHING`,
    ).bind(caseId, input.organizationId, id, input.resourceId ?? null, input.holdId ?? null, priority, dueAt, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.case_created', resourceType: 'risk_case', resourceId: caseId,
      payload: { evaluationId: id, transactionId: input.resourceId ?? null, decision: input.assessment.decision, score: input.assessment.score } });
  }
  return { ...input.assessment, id, resourceId: input.resourceId ?? null, createdAt: now };
}

export async function evaluateAndPersistRisk(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; operationType: RiskOperation; amountMinor: bigint; currency: Currency; counterparty: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk:${input.idempotencyKey}`).first();
    const assessment = await assessRisk(input, database);
    return persistRiskAssessment({ organizationId: input.organizationId, actor: input.actor, idempotencyKey: input.idempotencyKey, assessment }, database);
  });
}

export async function createRiskRule(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; name: string; kind: RiskRuleKind; operationType: 'any' | RiskOperation;
  scoreDelta: number; action: RiskRuleAction; configuration: Record<string, unknown>; priority: number;
}) {
  const fingerprint = await sha256(JSON.stringify({ name: input.name, kind: input.kind, operationType: input.operationType,
    scoreDelta: input.scoreDelta, action: input.action, configuration: input.configuration, priority: input.priority }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-rule:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `SELECT id, request_fingerprint AS "requestFingerprint", name, kind, operation_type AS "operationType", score_delta AS "scoreDelta",
        action, configuration, priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM risk_rules WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<Record<string, unknown> & { requestFingerprint: string; configuration: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya fue usada con otra regla.', 409, 'idempotency_mismatch');
      return { rule: { ...existing, configuration: parseConfiguration(existing.configuration) }, replayed: true };
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO risk_rules
        (id, organization_id, idempotency_key, request_fingerprint, name, kind, operation_type, score_delta, action, configuration, priority, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, fingerprint, input.name, input.kind, input.operationType, input.scoreDelta,
      input.action, JSON.stringify(input.configuration), input.priority, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.rule_created', resourceType: 'risk_rule', resourceId: id,
      payload: { name: input.name, kind: input.kind, operationType: input.operationType, action: input.action } });
    return { rule: { id, name: input.name, kind: input.kind, operationType: input.operationType, scoreDelta: input.scoreDelta,
      action: input.action, configuration: input.configuration, priority: input.priority, status: 'active', createdAt: now, updatedAt: now }, replayed: false };
  });
}

export async function listRiskState(organizationId: string) {
  const database = getDatabaseClient();
  const [rules, evaluations, cases] = await Promise.all([
    database.prepare(
      `SELECT id, name, kind, operation_type AS "operationType", score_delta AS "scoreDelta", action, configuration,
        priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM risk_rules WHERE organization_id = ? ORDER BY priority, created_at DESC LIMIT 100`,
    ).bind(organizationId).all<Record<string, unknown> & { configuration: string }>(),
    database.prepare(
      `SELECT id, operation_type AS "operationType", resource_type AS "resourceType", resource_id AS "resourceId",
        amount_minor::text AS "amountMinor", currency, counterparty, score, decision, matched_rule_ids AS "matchedRuleIds",
        reasons, created_at AS "createdAt", request_fingerprint AS "requestFingerprint"
       FROM risk_evaluations WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(organizationId).all<StoredEvaluation>(),
    database.prepare(
      `SELECT c.id, c.evaluation_id AS "evaluationId", c.transaction_id AS "transactionId", c.hold_id AS "holdId", c.status, c.priority,
        c.resolution, c.resolution_note AS "resolutionNote", c.resolved_at AS "resolvedAt", c.created_at AS "createdAt", c.updated_at AS "updatedAt",
        e.counterparty, e.amount_minor::text AS "amountMinor", e.currency, e.score, e.decision, e.reasons
       FROM risk_cases c JOIN risk_evaluations e ON e.id = c.evaluation_id
       WHERE c.organization_id = ? ORDER BY c.created_at DESC LIMIT 100`,
    ).bind(organizationId).all<Record<string, unknown> & { amountMinor: string; currency: Currency; reasons: string }>(),
  ]);
  return {
    systemPolicies: [
      { id: 'sys_amount_elevated', name: 'Monto elevado por moneda', action: 'score', status: 'active' },
      { id: 'sys_amount_high', name: 'Monto alto por moneda', action: 'review', status: 'active' },
      { id: 'sys_velocity_counterparty', name: 'Velocity por contraparte', action: 'review', status: 'active' },
    ],
    rules: rules.results.map((rule) => ({ ...rule, configuration: parseConfiguration(rule.configuration) })),
    evaluations: evaluations.results.map((evaluation) => serializeEvaluation(evaluation, false)),
    cases: cases.results.map((riskCase) => ({ ...riskCase, amount: minorToMajorNumber(riskCase.amountMinor, riskCase.currency), reasons: parseStringArray(riskCase.reasons) })),
  };
}

export async function disableRiskRule(organizationId: string, actor: AuthUser, id: string) {
  return getDatabaseClient().transaction(async (database) => {
    const now = new Date().toISOString();
    const rule = await database.prepare(
      `UPDATE risk_rules SET status = 'disabled', updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'active' RETURNING id`,
    ).bind(now, id, organizationId).first<{ id: string }>();
    if (!rule) return false;
    await audit(database, { organizationId, actorId: actor.userId, action: 'risk.rule_disabled', resourceType: 'risk_rule', resourceId: id });
    return true;
  });
}

export async function getRiskCaseForResolution(organizationId: string, id: string, database: DatabaseClient = getDatabaseClient()) {
  return database.prepare(
    `SELECT id, hold_id AS "holdId", status, resolution, resolution_idempotency_key AS "resolutionIdempotencyKey"
     FROM risk_cases WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(id, organizationId).first<{ id: string; holdId: string | null; status: string; resolution: string | null; resolutionIdempotencyKey: string | null }>();
}

export async function resolveRiskCase(input: {
  organizationId: string; actor: AuthUser; caseId: string; resolution: 'approved' | 'declined'; note: string; idempotencyKey: string;
  approvalContext?: { requestId: string; requestedBy: string };
}, database: DatabaseClient = getDatabaseClient()) {
  return database.transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-case:${input.idempotencyKey}`).first();
    const keyOwner = await database.prepare(
      `SELECT id FROM risk_cases WHERE organization_id = ? AND resolution_idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
    if (keyOwner && keyOwner.id !== input.caseId) throw new RiskError('La Idempotency-Key ya resolvió otro caso.', 409, 'idempotency_mismatch');
    const current = await database.prepare(
      `SELECT id, status, resolution, resolution_idempotency_key AS "resolutionIdempotencyKey" FROM risk_cases
       WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.caseId, input.organizationId).first<{ id: string; status: string; resolution: string | null; resolutionIdempotencyKey: string | null }>();
    if (!current) throw new RiskError('Caso de riesgo no encontrado.', 404, 'risk_case_not_found');
    if (current.status === 'resolved') {
      if (current.resolution === input.resolution && current.resolutionIdempotencyKey === input.idempotencyKey) return { id: current.id, status: current.status, resolution: current.resolution, replayed: true };
      throw new RiskError('El caso ya fue resuelto.', 409, 'risk_case_already_resolved');
    }
    const now = new Date().toISOString();
    await database.prepare(
      `UPDATE risk_cases SET status = 'resolved', resolution = ?, resolution_note = ?, resolution_idempotency_key = ?,
        resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(input.resolution, input.note, input.idempotencyKey, input.actor.userId, now, now, input.caseId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.case_resolved', resourceType: 'risk_case', resourceId: input.caseId,
      payload: { resolution: input.resolution, note: input.note, idempotencyKey: input.idempotencyKey,
        approvalRequestId: input.approvalContext?.requestId, requestedBy: input.approvalContext?.requestedBy } });
    return { id: input.caseId, status: 'resolved', resolution: input.resolution, replayed: false };
  });
}
