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
export type RiskRuleDeployment = 'champion' | 'challenger' | 'archived';

type StoredRule = {
  id: string; familyId: string; version: number; deployment: RiskRuleDeployment; name: string; kind: RiskRuleKind;
  operationType: 'any' | RiskOperation; scoreDelta: number; action: RiskRuleAction; configuration: string; priority: number; status: string;
};

type DecisionSummary = { approve: number; review: number; decline: number; averageScore: number };

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

async function loadChampionRules(organizationId: string, database: DatabaseClient) {
  return (await database.prepare(
    `SELECT id, family_id AS "familyId", version, deployment, name, kind, operation_type AS "operationType",
      score_delta AS "scoreDelta", action, configuration, priority, status
     FROM risk_rules WHERE organization_id = ? AND status = 'active' AND deployment = 'champion'
     ORDER BY priority ASC, created_at ASC`,
  ).bind(organizationId).all<StoredRule>()).results;
}

async function evaluateDecision(input: {
  organizationId: string; operationType: RiskOperation; amountMinor: bigint; currency: Currency; counterparty: string;
}, rules: StoredRule[], database: DatabaseClient): Promise<Omit<RiskAssessment, 'id' | 'createdAt' | 'requestFingerprint' | 'replayed'>> {
  let score = 7;
  let forceReview = false;
  let forceDecline = false;
  const matchedRuleIds: string[] = [];
  const reasons: string[] = [];
  const amountRisk = systemAmountRisk(input.amountMinor, input.currency);
  score += amountRisk.scoreDelta;
  forceReview ||= amountRisk.forceReview;
  if (amountRisk.ruleId && amountRisk.reason) { matchedRuleIds.push(amountRisk.ruleId); reasons.push(amountRisk.reason); }
  const velocity = await database.prepare(
    `SELECT COUNT(*)::int AS count FROM transactions
     WHERE organization_id = ? AND lower(counterparty) = lower(?) AND created_at >= ?`,
  ).bind(input.organizationId, input.counterparty, new Date(Date.now() - 60 * 60 * 1000).toISOString()).first<{ count: number }>();
  if (Number(velocity?.count ?? 0) >= 4) {
    score += 35; forceReview = true; matchedRuleIds.push('sys_velocity_counterparty'); reasons.push('counterparty_velocity');
  }
  for (const rule of rules) {
    if (rule.operationType !== 'any' && rule.operationType !== input.operationType) continue;
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
    reasons.push(`rule:${rule.name}:v${rule.version}`);
    if (rule.action === 'review') forceReview = true;
    if (rule.action === 'decline') forceDecline = true;
  }
  score = Math.min(100, Math.max(0, score));
  const decision: RiskDecision = forceDecline ? 'decline' : forceReview || score >= 60 ? 'review' : 'approve';
  return {
    operationType: input.operationType, resourceType: 'transaction', resourceId: null,
    amountMinor: input.amountMinor.toString(), amount: minorToMajorNumber(input.amountMinor, input.currency), currency: input.currency,
    counterparty: input.counterparty, score, decision, matchedRuleIds, reasons,
  };
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

  const decision = await evaluateDecision(input, await loadChampionRules(input.organizationId, database), database);
  return { ...decision, requestFingerprint: fingerprint, replayed: false };
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
      `SELECT id, request_fingerprint AS "requestFingerprint", family_id AS "familyId", version, deployment, name, kind,
        operation_type AS "operationType", score_delta AS "scoreDelta", action, configuration, priority, status,
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM risk_rules WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<Record<string, unknown> & { requestFingerprint: string; configuration: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya fue usada con otra regla.', 409, 'idempotency_mismatch');
      return { rule: { ...existing, configuration: parseConfiguration(existing.configuration) }, replayed: true };
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO risk_rules
        (id, organization_id, idempotency_key, request_fingerprint, family_id, version, deployment, name, kind, operation_type,
         score_delta, action, configuration, priority, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'champion', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, fingerprint, id, input.name, input.kind, input.operationType, input.scoreDelta,
      input.action, JSON.stringify(input.configuration), input.priority, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.rule_created', resourceType: 'risk_rule', resourceId: id,
      payload: { name: input.name, kind: input.kind, operationType: input.operationType, action: input.action } });
    return { rule: { id, familyId: id, version: 1, deployment: 'champion', name: input.name, kind: input.kind,
      operationType: input.operationType, scoreDelta: input.scoreDelta, action: input.action, configuration: input.configuration,
      priority: input.priority, status: 'active', createdAt: now, updatedAt: now }, replayed: false };
  });
}

export async function createRiskRuleVersion(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; baseRuleId: string; name: string; kind: RiskRuleKind;
  operationType: 'any' | RiskOperation; scoreDelta: number; action: RiskRuleAction; configuration: Record<string, unknown>; priority: number;
}) {
  const fingerprint = await sha256(JSON.stringify({ baseRuleId: input.baseRuleId, name: input.name, kind: input.kind,
    operationType: input.operationType, scoreDelta: input.scoreDelta, action: input.action, configuration: input.configuration, priority: input.priority }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-rule-version:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `SELECT id, request_fingerprint AS "requestFingerprint", family_id AS "familyId", version, deployment, name, kind,
        operation_type AS "operationType", score_delta AS "scoreDelta", action, configuration, priority, status,
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM risk_rules WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<Record<string, unknown> & { requestFingerprint: string; configuration: string }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya fue usada con otra versión.', 409, 'idempotency_mismatch');
      return { rule: { ...existing, configuration: parseConfiguration(existing.configuration) }, replayed: true };
    }
    const base = await database.prepare(
      `SELECT family_id AS "familyId" FROM risk_rules WHERE id = ? AND organization_id = ? LIMIT 1`,
    ).bind(input.baseRuleId, input.organizationId).first<{ familyId: string }>();
    if (!base) throw new RiskError('Política base no encontrada.', 404, 'risk_rule_not_found');
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-family:${base.familyId}`).first();
    const latest = await database.prepare(
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM risk_rules WHERE organization_id = ? AND family_id = ?`,
    ).bind(input.organizationId, base.familyId).first<{ version: number }>();
    const version = Number(latest?.version ?? 0) + 1;
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO risk_rules
        (id, organization_id, idempotency_key, request_fingerprint, family_id, version, deployment, name, kind, operation_type,
         score_delta, action, configuration, priority, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'challenger', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, fingerprint, base.familyId, version, input.name, input.kind,
      input.operationType, input.scoreDelta, input.action, JSON.stringify(input.configuration), input.priority, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.rule_version_created',
      resourceType: 'risk_rule', resourceId: id, payload: { familyId: base.familyId, version, deployment: 'challenger', baseRuleId: input.baseRuleId } });
    return { rule: { id, familyId: base.familyId, version, deployment: 'challenger', name: input.name, kind: input.kind,
      operationType: input.operationType, scoreDelta: input.scoreDelta, action: input.action, configuration: input.configuration,
      priority: input.priority, status: 'active', createdAt: now, updatedAt: now }, replayed: false };
  });
}

export async function promoteRiskRule(input: { organizationId: string; actor: AuthUser; idempotencyKey: string; ruleId: string }) {
  const fingerprint = await sha256(JSON.stringify({ ruleId: input.ruleId }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-promotion:${input.idempotencyKey}`).first();
    const replay = await database.prepare(
      `SELECT p.rule_id AS "ruleId", p.previous_champion_id AS "previousChampionId", p.request_fingerprint AS "requestFingerprint",
        p.created_at AS "createdAt", r.family_id AS "familyId", r.version
       FROM risk_rule_promotions p JOIN risk_rules r ON r.id = p.rule_id
       WHERE p.organization_id = ? AND p.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<Record<string, unknown> & { requestFingerprint: string }>();
    if (replay) {
      if (replay.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya promovió otra política.', 409, 'idempotency_mismatch');
      return { promotion: replay, replayed: true };
    }
    const candidate = await database.prepare(
      `SELECT id, family_id AS "familyId", version, deployment, status FROM risk_rules
       WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.ruleId, input.organizationId).first<{ id: string; familyId: string; version: number; deployment: RiskRuleDeployment; status: string }>();
    if (!candidate) throw new RiskError('Política candidata no encontrada.', 404, 'risk_rule_not_found');
    if (candidate.status !== 'active' || candidate.deployment !== 'challenger') {
      throw new RiskError('Sólo una versión challenger activa puede promoverse.', 409, 'risk_rule_not_challenger');
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-family:${candidate.familyId}`).first();
    const champion = await database.prepare(
      `SELECT id FROM risk_rules WHERE organization_id = ? AND family_id = ? AND deployment = 'champion' AND status = 'active'
       FOR UPDATE`,
    ).bind(input.organizationId, candidate.familyId).first<{ id: string }>();
    const now = new Date().toISOString();
    if (champion) await database.prepare(
      `UPDATE risk_rules SET status = 'disabled', deployment = 'archived', updated_at = ? WHERE id = ?`,
    ).bind(now, champion.id).run();
    await database.prepare(
      `UPDATE risk_rules SET deployment = 'champion', updated_at = ? WHERE id = ?`,
    ).bind(now, candidate.id).run();
    const promotionId = crypto.randomUUID();
    await database.prepare(
      `INSERT INTO risk_rule_promotions
        (id, organization_id, rule_id, previous_champion_id, idempotency_key, request_fingerprint, promoted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(promotionId, input.organizationId, candidate.id, champion?.id ?? null, input.idempotencyKey, fingerprint, input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.rule_promoted',
      resourceType: 'risk_rule', resourceId: candidate.id,
      payload: { familyId: candidate.familyId, version: candidate.version, previousChampionId: champion?.id ?? null } });
    return { promotion: { id: promotionId, ruleId: candidate.id, previousChampionId: champion?.id ?? null,
      familyId: candidate.familyId, version: candidate.version, createdAt: now }, replayed: false };
  });
}

function summarizeDecisions(decisions: Array<{ decision: RiskDecision; score: number }>): DecisionSummary {
  const totalScore = decisions.reduce((sum, item) => sum + item.score, 0);
  return {
    approve: decisions.filter((item) => item.decision === 'approve').length,
    review: decisions.filter((item) => item.decision === 'review').length,
    decline: decisions.filter((item) => item.decision === 'decline').length,
    averageScore: decisions.length === 0 ? 0 : Math.round((totalScore / decisions.length) * 100) / 100,
  };
}

function parseSimulation(row: Record<string, unknown> & { baselineSummary: string; candidateSummary: string; deltaSummary: string }) {
  return { ...row, baselineSummary: parseConfiguration(row.baselineSummary), candidateSummary: parseConfiguration(row.candidateSummary),
    deltaSummary: parseConfiguration(row.deltaSummary) };
}

export async function simulateRiskRule(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; candidateRuleId: string;
  samples: Array<{ operationType: RiskOperation; amountMinor: bigint; currency: Currency; counterparty: string }>;
}) {
  const fingerprint = await sha256(JSON.stringify({ candidateRuleId: input.candidateRuleId,
    samples: input.samples.map((sample) => ({ ...sample, amountMinor: sample.amountMinor.toString() })) }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:risk-simulation:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `SELECT id, candidate_rule_id AS "candidateRuleId", baseline_rule_id AS "baselineRuleId", sample_count AS "sampleCount",
        baseline_summary AS "baselineSummary", candidate_summary AS "candidateSummary", delta_summary AS "deltaSummary",
        request_fingerprint AS "requestFingerprint", created_at AS "createdAt"
       FROM risk_simulations WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<Record<string, unknown> & {
      requestFingerprint: string; baselineSummary: string; candidateSummary: string; deltaSummary: string;
    }>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new RiskError('La Idempotency-Key ya fue usada con otra simulación.', 409, 'idempotency_mismatch');
      return { simulation: parseSimulation(existing), replayed: true };
    }
    const candidate = await database.prepare(
      `SELECT id, family_id AS "familyId", version, deployment, name, kind, operation_type AS "operationType",
        score_delta AS "scoreDelta", action, configuration, priority, status
       FROM risk_rules WHERE id = ? AND organization_id = ? LIMIT 1`,
    ).bind(input.candidateRuleId, input.organizationId).first<StoredRule>();
    if (!candidate) throw new RiskError('Política candidata no encontrada.', 404, 'risk_rule_not_found');
    if (candidate.status !== 'active' || candidate.deployment !== 'challenger') {
      throw new RiskError('Sólo una versión challenger activa puede simularse.', 409, 'risk_rule_not_challenger');
    }
    const champions = await loadChampionRules(input.organizationId, database);
    const baselineRule = champions.find((rule) => rule.familyId === candidate.familyId) ?? null;
    const candidateRules = [...champions.filter((rule) => rule.familyId !== candidate.familyId), candidate]
      .sort((left, right) => left.priority - right.priority);
    const baselineDecisions: Array<{ decision: RiskDecision; score: number }> = [];
    const candidateDecisions: Array<{ decision: RiskDecision; score: number }> = [];
    for (const sample of input.samples) {
      baselineDecisions.push(await evaluateDecision({ organizationId: input.organizationId, ...sample }, champions, database));
      candidateDecisions.push(await evaluateDecision({ organizationId: input.organizationId, ...sample }, candidateRules, database));
    }
    const baselineSummary = summarizeDecisions(baselineDecisions);
    const candidateSummary = summarizeDecisions(candidateDecisions);
    const deltaSummary = {
      decisionsChanged: candidateDecisions.filter((item, index) => item.decision !== baselineDecisions[index].decision).length,
      newlyReviewed: candidateDecisions.filter((item, index) => item.decision === 'review' && baselineDecisions[index].decision !== 'review').length,
      newlyDeclined: candidateDecisions.filter((item, index) => item.decision === 'decline' && baselineDecisions[index].decision !== 'decline').length,
      newlyApproved: candidateDecisions.filter((item, index) => item.decision === 'approve' && baselineDecisions[index].decision !== 'approve').length,
      averageScoreDelta: Math.round((candidateSummary.averageScore - baselineSummary.averageScore) * 100) / 100,
    };
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(
      `INSERT INTO risk_simulations
        (id, organization_id, candidate_rule_id, baseline_rule_id, idempotency_key, request_fingerprint, sample_count,
         baseline_summary, candidate_summary, delta_summary, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, candidate.id, baselineRule?.id ?? null, input.idempotencyKey, fingerprint, input.samples.length,
      JSON.stringify(baselineSummary), JSON.stringify(candidateSummary), JSON.stringify(deltaSummary), input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'risk.simulation_completed',
      resourceType: 'risk_simulation', resourceId: id,
      payload: { candidateRuleId: candidate.id, baselineRuleId: baselineRule?.id ?? null, sampleCount: input.samples.length, ...deltaSummary } });
    return { simulation: { id, candidateRuleId: candidate.id, baselineRuleId: baselineRule?.id ?? null,
      sampleCount: input.samples.length, baselineSummary, candidateSummary, deltaSummary, createdAt: now }, replayed: false };
  });
}

export async function listRiskState(organizationId: string) {
  const database = getDatabaseClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [rules, evaluations, cases, simulations, evaluationMetrics, resolutionMetrics] = await Promise.all([
    database.prepare(
      `SELECT id, family_id AS "familyId", version, deployment, name, kind, operation_type AS "operationType", score_delta AS "scoreDelta", action, configuration,
        priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM risk_rules WHERE organization_id = ? ORDER BY family_id, version DESC LIMIT 100`,
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
    database.prepare(
      `SELECT s.id, s.candidate_rule_id AS "candidateRuleId", s.baseline_rule_id AS "baselineRuleId", s.sample_count AS "sampleCount",
        s.baseline_summary AS "baselineSummary", s.candidate_summary AS "candidateSummary", s.delta_summary AS "deltaSummary",
        s.created_at AS "createdAt", r.name AS "candidateName", r.version AS "candidateVersion"
       FROM risk_simulations s JOIN risk_rules r ON r.id = s.candidate_rule_id
       WHERE s.organization_id = ? ORDER BY s.created_at DESC LIMIT 20`,
    ).bind(organizationId).all<Record<string, unknown> & { baselineSummary: string; candidateSummary: string; deltaSummary: string }>(),
    database.prepare(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE decision = 'approve')::int AS approve,
        COUNT(*) FILTER (WHERE decision = 'review')::int AS review,
        COUNT(*) FILTER (WHERE decision = 'decline')::int AS decline
       FROM risk_evaluations WHERE organization_id = ? AND created_at >= ?`,
    ).bind(organizationId, since).first<{ total: number; approve: number; review: number; decline: number }>(),
    database.prepare(
      `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolution = 'approved')::int AS approved
       FROM risk_cases WHERE organization_id = ?`,
    ).bind(organizationId).first<{ open: number; resolved: number; approved: number }>(),
  ]);
  const resolved = Number(resolutionMetrics?.resolved ?? 0);
  const approvedAfterReview = Number(resolutionMetrics?.approved ?? 0);
  return {
    systemPolicies: [
      { id: 'sys_amount_elevated', name: 'Monto elevado por moneda', action: 'score', status: 'active' },
      { id: 'sys_amount_high', name: 'Monto alto por moneda', action: 'review', status: 'active' },
      { id: 'sys_velocity_counterparty', name: 'Velocity por contraparte', action: 'review', status: 'active' },
    ],
    rules: rules.results.map((rule) => ({ ...rule, configuration: parseConfiguration(rule.configuration) })),
    evaluations: evaluations.results.map((evaluation) => serializeEvaluation(evaluation, false)),
    cases: cases.results.map((riskCase) => ({ ...riskCase, amount: minorToMajorNumber(riskCase.amountMinor, riskCase.currency), reasons: parseStringArray(riskCase.reasons) })),
    simulations: simulations.results.map((simulation) => ({ ...simulation,
      baselineSummary: parseConfiguration(simulation.baselineSummary), candidateSummary: parseConfiguration(simulation.candidateSummary),
      deltaSummary: parseConfiguration(simulation.deltaSummary) })),
    metrics: {
      windowDays: 30, totalEvaluations: Number(evaluationMetrics?.total ?? 0), approvals: Number(evaluationMetrics?.approve ?? 0),
      reviews: Number(evaluationMetrics?.review ?? 0), declines: Number(evaluationMetrics?.decline ?? 0),
      openCases: Number(resolutionMetrics?.open ?? 0), resolvedCases: resolved, approvedAfterReview,
      falsePositiveProxyRate: resolved === 0 ? null : Math.round((approvedAfterReview / resolved) * 10_000) / 100,
    },
  };
}

export async function disableRiskRule(organizationId: string, actor: AuthUser, id: string) {
  return getDatabaseClient().transaction(async (database) => {
    const now = new Date().toISOString();
    const rule = await database.prepare(
      `UPDATE risk_rules SET status = 'disabled', deployment = 'archived', updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'active' RETURNING id`,
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
