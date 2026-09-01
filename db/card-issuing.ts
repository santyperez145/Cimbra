import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { CARD_CONTROL_CHANNELS, normalizeCardTransition, serializeCardLimit, type CardFormat, type CardProduct, type CardStatus, type NormalizedCardControlsInput, type NormalizedCardProgramInput } from '@/app/lib/platform/card-issuing';
import type { Currency } from '@/app/lib/ledger/money';
import { enqueueWebhookEvent } from './platform';
import { type DatabaseClient, getDatabaseClient } from './client';
import { assertSandboxLedgerOrCertifiedRail } from './platform-rails';

export class CardIssuingError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'card_issuing_error') { super(message); }
}

export type CardProgram = {
  id: string; name: string; product: CardProduct; formats: CardFormat[]; defaultCurrency: Currency;
  status: 'active' | 'inactive'; createdAt: string;
};

type StoredCardProgram = Omit<CardProgram, 'formats'> & { formats: string; requestFingerprint: string };

export type CardLifecycleEvent = {
  id: string; cardId: string; fromStatus: CardStatus | null; toStatus: CardStatus; reason: string;
  actorId: string; actorName: string; createdAt: string;
};

export type CardControls = {
  id: string; cardId: string; version: number; currency: Currency;
  perTransactionLimitMinor: string | null; perTransactionLimit: string | null;
  dailyLimitMinor: string | null; dailyLimit: string | null;
  monthlyLimitMinor: string | null; monthlyLimit: string | null;
  allowedChannels: string[]; allowedMccs: string[]; blockedMccs: string[];
  status: 'active' | 'inactive'; createdBy: string; createdByName: string; createdAt: string;
};

type StoredCardControls = {
  id: string; cardId: string; version: number; currency: Currency;
  perTransactionLimitMinor: string | null; dailyLimitMinor: string | null; monthlyLimitMinor: string | null;
  allowedChannels: string; allowedMccs: string; blockedMccs: string; status: 'active' | 'inactive';
  createdBy: string; createdByName: string; createdAt: string; requestFingerprint: string;
};

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function serializeProgram(row: StoredCardProgram): CardProgram {
  return { id: row.id, name: row.name, product: row.product, formats: parseArray(row.formats) as CardFormat[],
    defaultCurrency: row.defaultCurrency, status: row.status, createdAt: row.createdAt };
}

function serializeControls(row: StoredCardControls): CardControls {
  return {
    id: row.id, cardId: row.cardId, version: row.version, currency: row.currency,
    perTransactionLimitMinor: row.perTransactionLimitMinor, perTransactionLimit: serializeCardLimit(row.perTransactionLimitMinor, row.currency),
    dailyLimitMinor: row.dailyLimitMinor, dailyLimit: serializeCardLimit(row.dailyLimitMinor, row.currency),
    monthlyLimitMinor: row.monthlyLimitMinor, monthlyLimit: serializeCardLimit(row.monthlyLimitMinor, row.currency),
    allowedChannels: parseArray(row.allowedChannels), allowedMccs: parseArray(row.allowedMccs), blockedMccs: parseArray(row.blockedMccs),
    status: row.status, createdBy: row.createdBy, createdByName: row.createdByName, createdAt: row.createdAt,
  };
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceType: string; resourceId: string; payload: Record<string, unknown>;
}) {
  const createdAt = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType, input.resourceId,
    JSON.stringify(input.payload), createdAt).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

const programSelect = `SELECT id, name, product, formats, default_currency AS "defaultCurrency", status,
  request_fingerprint AS "requestFingerprint", created_at AS "createdAt" FROM card_programs`;

export async function listCardPrograms(organizationId: string) {
  const rows = await getDatabaseClient().prepare(
    `${programSelect} WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(organizationId).all<StoredCardProgram>();
  return rows.results.map(serializeProgram);
}

export async function retrieveCardProgram(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${programSelect} WHERE organization_id = ? AND id = ? LIMIT 1`)
    .bind(organizationId, id).first<StoredCardProgram>();
  return row ? serializeProgram(row) : null;
}

export async function createCardProgram(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; program: NormalizedCardProgramInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('card_issuing', CardIssuingError);
  const requestFingerprint = await sha256(JSON.stringify(input.program));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:card-program:${input.idempotencyKey}`).first();
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:card-program-name:${input.program.name.toLocaleLowerCase('es')}`).first();
    const existing = await database.prepare(`${programSelect} WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<StoredCardProgram>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new CardIssuingError('La Idempotency-Key ya fue usada con otro programa.', 409, 'idempotency_mismatch');
      }
      return { program: serializeProgram(existing), replayed: true };
    }
    const duplicate = await database.prepare(
      'SELECT id FROM card_programs WHERE organization_id = ? AND lower(name) = lower(?) LIMIT 1',
    ).bind(input.organizationId, input.program.name).first<{ id: string }>();
    if (duplicate) throw new CardIssuingError('Ya existe un programa con ese nombre.', 409, 'card_program_name_conflict');
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    await database.prepare(
      `INSERT INTO card_programs
        (id, organization_id, idempotency_key, request_fingerprint, name, product, formats, default_currency, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, requestFingerprint, input.program.name, input.program.product,
      JSON.stringify(input.program.formats), input.program.defaultCurrency, input.actor.userId, createdAt).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'card.program_created',
      resourceType: 'card_program', resourceId: id, payload: { name: input.program.name, product: input.program.product,
        formats: input.program.formats, defaultCurrency: input.program.defaultCurrency } });
    return { program: { id, ...input.program, status: 'active' as const, createdAt }, replayed: false };
  });
}

export async function initializeCardIssuingRecords(database: DatabaseClient, input: {
  organizationId: string; actor: AuthUser; cardId: string; idempotencyKey: string; requestFingerprint: string;
  status: CardStatus; currency: Currency; createdAt: string;
}) {
  await database.prepare(
    `INSERT INTO card_lifecycle_events
      (id, organization_id, card_id, idempotency_key, request_fingerprint, from_status, to_status, reason, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'issued', ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.cardId, input.idempotencyKey, input.requestFingerprint,
    input.status, input.actor.userId, input.createdAt).run();
  await database.prepare(
    `INSERT INTO card_controls
      (id, organization_id, card_id, idempotency_key, request_fingerprint, version, currency,
       per_transaction_limit_minor, daily_limit_minor, monthly_limit_minor, allowed_channels, allowed_mccs, blocked_mccs,
       status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, ?, '[]', '[]', 'active', ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.cardId, input.idempotencyKey, input.requestFingerprint,
    input.currency, JSON.stringify(CARD_CONTROL_CHANNELS), input.actor.userId, input.createdAt).run();
}

const lifecycleSelect = `SELECT e.id, e.card_id AS "cardId", e.from_status AS "fromStatus", e.to_status AS "toStatus",
  e.reason, e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt"
  FROM card_lifecycle_events e JOIN users u ON u.id = e.actor_id`;

export async function listCardLifecycle(organizationId: string, cardId: string) {
  const card = await getDatabaseClient().prepare('SELECT id FROM cards WHERE organization_id = ? AND id = ? LIMIT 1')
    .bind(organizationId, cardId).first<{ id: string }>();
  if (!card) throw new CardIssuingError('Tarjeta no encontrada.', 404, 'card_not_found');
  return (await getDatabaseClient().prepare(
    `${lifecycleSelect} WHERE e.organization_id = ? AND e.card_id = ? ORDER BY e.created_at DESC LIMIT 100`,
  ).bind(organizationId, cardId).all<CardLifecycleEvent>()).results;
}

function lifecycleAction(fromStatus: CardStatus, toStatus: CardStatus) {
  if (toStatus === 'frozen') return 'card.frozen';
  if (toStatus === 'terminated') return 'card.terminated';
  return fromStatus === 'created' ? 'card.activated' : 'card.unfrozen';
}

export async function transitionCardStatus(input: {
  organizationId: string; actor: AuthUser; cardId: string; idempotencyKey: string; value: unknown;
}) {
  const requested = input.value && typeof input.value === 'object' && !Array.isArray(input.value)
    ? { status: (input.value as Record<string, unknown>).status, reason: (input.value as Record<string, unknown>).reason } : {};
  const requestFingerprint = await sha256(JSON.stringify({ cardId: input.cardId, ...requested }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:card-lifecycle:${input.idempotencyKey}`).first();
    const replay = await database.prepare(
      `SELECT e.id, e.card_id AS "cardId", e.from_status AS "fromStatus", e.to_status AS "toStatus", e.reason,
        e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt",
        e.request_fingerprint AS "requestFingerprint"
       FROM card_lifecycle_events e JOIN users u ON u.id = e.actor_id
       WHERE e.organization_id = ? AND e.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<CardLifecycleEvent & { requestFingerprint: string }>();
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new CardIssuingError('La Idempotency-Key ya fue usada con otra transición.', 409, 'idempotency_mismatch');
      }
      return { event: {
        id: replay.id, cardId: replay.cardId, fromStatus: replay.fromStatus, toStatus: replay.toStatus,
        reason: replay.reason, actorId: replay.actorId, actorName: replay.actorName, createdAt: replay.createdAt,
      }, replayed: true };
    }
    const card = await database.prepare(
      `SELECT id, status FROM cards WHERE organization_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
    ).bind(input.organizationId, input.cardId).first<{ id: string; status: CardStatus }>();
    if (!card) throw new CardIssuingError('Tarjeta no encontrada.', 404, 'card_not_found');
    const transition = normalizeCardTransition(input.value, card.status);
    if (!transition) throw new CardIssuingError('La transición o su motivo no son válidos para el estado actual.', 409, 'invalid_card_transition');
    const createdAt = new Date().toISOString(); const eventId = crypto.randomUUID();
    await database.prepare(
      `UPDATE cards SET status = ?, status_reason = ?, updated_at = ?,
        activated_at = CASE WHEN ? = 'active' THEN COALESCE(activated_at, ?) ELSE activated_at END,
        terminated_at = CASE WHEN ? = 'terminated' THEN ? ELSE terminated_at END
       WHERE organization_id = ? AND id = ?`,
    ).bind(transition.status, transition.reason, createdAt, transition.status, createdAt, transition.status, createdAt,
      input.organizationId, input.cardId).run();
    await database.prepare(
      `INSERT INTO card_lifecycle_events
        (id, organization_id, card_id, idempotency_key, request_fingerprint, from_status, to_status, reason, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(eventId, input.organizationId, input.cardId, input.idempotencyKey, requestFingerprint, card.status,
      transition.status, transition.reason, input.actor.userId, createdAt).run();
    const action = lifecycleAction(card.status, transition.status);
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action,
      resourceType: 'card', resourceId: input.cardId, payload: { fromStatus: card.status, toStatus: transition.status, reason: transition.reason } });
    return { event: { id: eventId, cardId: input.cardId, fromStatus: card.status, toStatus: transition.status,
      reason: transition.reason, actorId: input.actor.userId, actorName: input.actor.displayName, createdAt }, replayed: false };
  });
}

const controlsSelect = `SELECT c.id, c.card_id AS "cardId", c.version, c.currency,
  c.per_transaction_limit_minor::text AS "perTransactionLimitMinor", c.daily_limit_minor::text AS "dailyLimitMinor",
  c.monthly_limit_minor::text AS "monthlyLimitMinor", c.allowed_channels AS "allowedChannels", c.allowed_mccs AS "allowedMccs",
  c.blocked_mccs AS "blockedMccs", c.status, c.created_by AS "createdBy", u.display_name AS "createdByName",
  c.created_at AS "createdAt", c.request_fingerprint AS "requestFingerprint"
  FROM card_controls c JOIN users u ON u.id = c.created_by`;

export async function getLatestCardControls(organizationId: string, cardId: string) {
  const card = await getDatabaseClient().prepare('SELECT id FROM cards WHERE organization_id = ? AND id = ? LIMIT 1')
    .bind(organizationId, cardId).first<{ id: string }>();
  if (!card) throw new CardIssuingError('Tarjeta no encontrada.', 404, 'card_not_found');
  const row = await getDatabaseClient().prepare(
    `${controlsSelect} WHERE c.organization_id = ? AND c.card_id = ? ORDER BY c.version DESC LIMIT 1`,
  ).bind(organizationId, cardId).first<StoredCardControls>();
  return row ? serializeControls(row) : null;
}

export async function replaceCardControls(input: {
  organizationId: string; actor: AuthUser; cardId: string; idempotencyKey: string; controls: NormalizedCardControlsInput;
}) {
  const requestFingerprint = await sha256(JSON.stringify({ cardId: input.cardId, ...input.controls }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:card-controls:${input.idempotencyKey}`).first();
    const replay = await database.prepare(
      `${controlsSelect} WHERE c.organization_id = ? AND c.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<StoredCardControls>();
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new CardIssuingError('La Idempotency-Key ya fue usada con otros controles.', 409, 'idempotency_mismatch');
      }
      return { controls: serializeControls(replay), replayed: true };
    }
    const card = await database.prepare(
      `SELECT c.id, c.status AS "cardStatus", a.currency FROM cards c JOIN accounts a ON a.id = c.account_id
       WHERE c.organization_id = ? AND c.id = ? LIMIT 1 FOR UPDATE OF c`,
    ).bind(input.organizationId, input.cardId).first<{ id: string; cardStatus: CardStatus; currency: Currency }>();
    if (!card) throw new CardIssuingError('Tarjeta no encontrada.', 404, 'card_not_found');
    if (card.cardStatus === 'terminated') {
      throw new CardIssuingError('Los controles de una tarjeta terminada son inmutables.', 409, 'card_terminated');
    }
    if (card.currency !== input.controls.currency) {
      throw new CardIssuingError('La moneda de los controles debe coincidir con la cuenta vinculada.', 409, 'card_control_currency_mismatch');
    }
    const latest = await database.prepare(
      'SELECT version FROM card_controls WHERE organization_id = ? AND card_id = ? ORDER BY version DESC LIMIT 1',
    ).bind(input.organizationId, input.cardId).first<{ version: number }>();
    const version = Number(latest?.version ?? 0) + 1; const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    await database.prepare(
      `INSERT INTO card_controls
        (id, organization_id, card_id, idempotency_key, request_fingerprint, version, currency,
         per_transaction_limit_minor, daily_limit_minor, monthly_limit_minor, allowed_channels, allowed_mccs, blocked_mccs,
         status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, input.cardId, input.idempotencyKey, requestFingerprint, version, input.controls.currency,
      input.controls.perTransactionLimitMinor, input.controls.dailyLimitMinor, input.controls.monthlyLimitMinor,
      JSON.stringify(input.controls.allowedChannels), JSON.stringify(input.controls.allowedMccs), JSON.stringify(input.controls.blockedMccs),
      input.controls.status, input.actor.userId, createdAt).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'card.controls_updated',
      resourceType: 'card', resourceId: input.cardId, payload: { version, currency: input.controls.currency,
        perTransactionLimitMinor: input.controls.perTransactionLimitMinor, dailyLimitMinor: input.controls.dailyLimitMinor,
        monthlyLimitMinor: input.controls.monthlyLimitMinor, allowedChannels: input.controls.allowedChannels,
        allowedMccs: input.controls.allowedMccs, blockedMccs: input.controls.blockedMccs, status: input.controls.status } });
    return { controls: serializeControls({ id, cardId: input.cardId, version, currency: input.controls.currency,
      perTransactionLimitMinor: input.controls.perTransactionLimitMinor, dailyLimitMinor: input.controls.dailyLimitMinor,
      monthlyLimitMinor: input.controls.monthlyLimitMinor, allowedChannels: JSON.stringify(input.controls.allowedChannels),
      allowedMccs: JSON.stringify(input.controls.allowedMccs), blockedMccs: JSON.stringify(input.controls.blockedMccs),
      status: input.controls.status, createdBy: input.actor.userId, createdByName: input.actor.displayName,
      createdAt, requestFingerprint }), replayed: false };
  });
}
