import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import {
  POCKET_LABELS, accountStatusForWallet, normalizeWalletTransition,
  type NormalizedWalletInput, type NormalizedWalletPocketTransferInput, type NormalizedWalletProgramInput,
  type WalletPocketKind, type WalletStatus,
} from '@/app/lib/platform/wallets-input';
import { ApprovalError, createBookTransferWithApprovalPolicy } from './approvals';
import { BookTransferError } from './book-transfers';
import { type DatabaseClient, getDatabaseClient } from './client';
import { assertCustomerDueDiligenceApproved, DueDiligenceError } from './due-diligence';
import { accountBalanceMinor, activeHoldsMinor, createProductLedgerAccount } from './ledger';
import { enqueueWebhookEvent } from './platform';

export class WalletError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'wallet_error') { super(message); }
}

export type WalletProgram = {
  id: string; name: string; displayName: string; supportUrl: string | null; termsUrl: string | null;
  accentColor: string | null; defaultCurrency: Currency; allowedCurrencies: Currency[];
  pocketKinds: WalletPocketKind[]; status: 'active' | 'inactive'; createdAt: string; updatedAt: string;
};

export type WalletPocket = {
  id: string; walletId: string; accountId: string; accountReference: string; kind: WalletPocketKind; label: string;
  currency: Currency; status: string; balanceMinor: string; balance: number; createdAt: string;
};

export type Wallet = {
  id: string; programId: string; programName: string; programDisplayName: string; customerId: string; customerName: string;
  externalReference: string; status: WalletStatus; statusReason: string | null; pocketCount: number;
  createdAt: string; updatedAt: string;
};

export type WalletLifecycleEvent = {
  id: string; walletId: string; fromStatus: WalletStatus | null; toStatus: WalletStatus; reason: string;
  actorId: string; actorName: string; createdAt: string;
};

type StoredProgram = Omit<WalletProgram, 'allowedCurrencies' | 'pocketKinds'> & {
  allowedCurrencies: string; pocketKinds: string; requestFingerprint: string;
};

type WalletRow = Wallet & { requestFingerprint: string };

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function serializeProgram(row: StoredProgram): WalletProgram {
  const { requestFingerprint: _fingerprint, ...publicRow } = row; void _fingerprint;
  return {
    ...publicRow,
    allowedCurrencies: parseArray(row.allowedCurrencies) as Currency[],
    pocketKinds: parseArray(row.pocketKinds) as WalletPocketKind[],
  };
}

function serializeWallet(row: WalletRow): Wallet {
  const { requestFingerprint: _fingerprint, ...publicRow } = row; void _fingerprint;
  return publicRow;
}

function serializePocket(row: Omit<WalletPocket, 'balance'>): WalletPocket {
  return { ...row, balance: minorToMajorNumber(BigInt(row.balanceMinor), row.currency) };
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

const programSelect = `SELECT id, name, display_name AS "displayName", support_url AS "supportUrl", terms_url AS "termsUrl",
  accent_color AS "accentColor", default_currency AS "defaultCurrency", allowed_currencies AS "allowedCurrencies",
  pocket_kinds AS "pocketKinds", status, request_fingerprint AS "requestFingerprint", created_at AS "createdAt",
  updated_at AS "updatedAt" FROM wallet_programs`;

const walletSelect = `SELECT w.id, w.program_id AS "programId", p.name AS "programName", p.display_name AS "programDisplayName",
  w.customer_id AS "customerId", c.name AS "customerName", w.external_reference AS "externalReference", w.status,
  w.status_reason AS "statusReason", (SELECT COUNT(*)::int FROM wallet_pockets wp WHERE wp.wallet_id = w.id) AS "pocketCount",
  w.request_fingerprint AS "requestFingerprint", w.created_at AS "createdAt", w.updated_at AS "updatedAt"
  FROM wallets w JOIN wallet_programs p ON p.id = w.program_id JOIN customers c ON c.id = w.customer_id`;

const pocketSelect = `SELECT wp.id, wp.wallet_id AS "walletId", wp.account_id AS "accountId",
  a.account_reference AS "accountReference", wp.kind, wp.label, a.currency, a.status,
  COALESCE(SUM(CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS "balanceMinor",
  wp.created_at AS "createdAt"
  FROM wallet_pockets wp
  JOIN accounts a ON a.id = wp.account_id
  JOIN financial_accounts f ON f.id = a.ledger_account_id
  LEFT JOIN ledger_postings p ON p.account_id = f.id`;

export async function listWalletPrograms(organizationId: string) {
  const rows = await getDatabaseClient().prepare(
    `${programSelect} WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(organizationId).all<StoredProgram>();
  return rows.results.map(serializeProgram);
}

export async function retrieveWalletProgram(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${programSelect} WHERE organization_id = ? AND id = ? LIMIT 1`)
    .bind(organizationId, id).first<StoredProgram>();
  return row ? serializeProgram(row) : null;
}

export async function createWalletProgram(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; program: NormalizedWalletProgramInput;
}) {
  const requestFingerprint = await sha256(JSON.stringify(input.program));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet-program:${input.idempotencyKey}`).first();
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet-program-name:${input.program.name.toLocaleLowerCase('es')}`).first();
    const existing = await database.prepare(`${programSelect} WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<StoredProgram>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new WalletError('La Idempotency-Key ya fue usada con otro programa de wallet.', 409, 'idempotency_mismatch');
      }
      return { program: serializeProgram(existing), replayed: true };
    }
    const duplicate = await database.prepare(
      'SELECT id FROM wallet_programs WHERE organization_id = ? AND lower(name) = lower(?) LIMIT 1',
    ).bind(input.organizationId, input.program.name).first<{ id: string }>();
    if (duplicate) throw new WalletError('Ya existe un programa de wallet con ese nombre.', 409, 'wallet_program_name_conflict');
    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    await database.prepare(
      `INSERT INTO wallet_programs
        (id, organization_id, idempotency_key, request_fingerprint, name, display_name, support_url, terms_url, accent_color,
         default_currency, allowed_currencies, pocket_kinds, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(id, input.organizationId, input.idempotencyKey, requestFingerprint, input.program.name, input.program.displayName,
      input.program.supportUrl, input.program.termsUrl, input.program.accentColor, input.program.defaultCurrency,
      JSON.stringify(input.program.allowedCurrencies), JSON.stringify(input.program.pocketKinds),
      input.actor.userId, createdAt, createdAt).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'wallet.program_created',
      resourceType: 'wallet_program', resourceId: id, payload: { name: input.program.name, displayName: input.program.displayName,
        defaultCurrency: input.program.defaultCurrency, pocketKinds: input.program.pocketKinds } });
    return { program: { id, ...input.program, status: 'active' as const, createdAt, updatedAt: createdAt }, replayed: false };
  });
}

export async function listWallets(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (w.created_at, w.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${walletSelect} WHERE w.organization_id = ? ${clause} ORDER BY w.created_at DESC, w.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<WalletRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<WalletRow>();
  return rows.results.map(serializeWallet);
}

export async function retrieveWallet(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await database.prepare(`${walletSelect} WHERE w.organization_id = ? AND w.id = ? LIMIT 1`)
    .bind(organizationId, id).first<WalletRow>();
  return row ? serializeWallet(row) : null;
}

export async function listWalletPockets(organizationId: string, walletId: string, database = getDatabaseClient()) {
  const wallet = await retrieveWallet(organizationId, walletId, database);
  if (!wallet) throw new WalletError('Wallet no encontrada.', 404, 'wallet_not_found');
  const rows = await database.prepare(
    `${pocketSelect} WHERE wp.organization_id = ? AND wp.wallet_id = ? GROUP BY wp.id, a.id, f.normal_balance
     ORDER BY wp.kind, wp.created_at`,
  ).bind(organizationId, walletId).all<Omit<WalletPocket, 'balance'>>();
  return rows.results.map(serializePocket);
}

export async function listWalletLifecycle(organizationId: string, walletId: string) {
  const wallet = await retrieveWallet(organizationId, walletId);
  if (!wallet) throw new WalletError('Wallet no encontrada.', 404, 'wallet_not_found');
  const rows = await getDatabaseClient().prepare(
    `SELECT e.id, e.wallet_id AS "walletId", e.from_status AS "fromStatus", e.to_status AS "toStatus",
      e.reason, e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt"
     FROM wallet_lifecycle_events e JOIN users u ON u.id = e.actor_id
     WHERE e.organization_id = ? AND e.wallet_id = ? ORDER BY e.created_at ASC`,
  ).bind(organizationId, walletId).all<WalletLifecycleEvent>();
  return rows.results;
}

async function insertLifecycle(database: DatabaseClient, input: {
  organizationId: string; walletId: string; idempotencyKey: string; requestFingerprint: string;
  fromStatus: WalletStatus | null; toStatus: WalletStatus; reason: string; actorId: string; createdAt: string;
}) {
  await database.prepare(
    `INSERT INTO wallet_lifecycle_events
      (id, organization_id, wallet_id, idempotency_key, request_fingerprint, from_status, to_status, reason, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.walletId, input.idempotencyKey, input.requestFingerprint,
    input.fromStatus, input.toStatus, input.reason, input.actorId, input.createdAt).run();
}

export async function createWallet(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; wallet: NormalizedWalletInput;
}) {
  const requestFingerprint = await sha256(JSON.stringify(input.wallet));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${walletSelect} WHERE w.organization_id = ? AND w.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<WalletRow>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new WalletError('La Idempotency-Key ya fue usada con otra wallet.', 409, 'idempotency_mismatch');
      }
      return { wallet: serializeWallet(existing), pockets: await listWalletPockets(input.organizationId, existing.id, database), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet-reference:${input.wallet.externalReference}`).first();
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet-program-customer:${input.wallet.programId}:${input.wallet.customerId}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM wallets WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.wallet.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new WalletError('La referencia externa ya pertenece a otra wallet.', 409, 'external_reference_conflict');
    const program = await database.prepare(`${programSelect} WHERE organization_id = ? AND id = ? LIMIT 1`)
      .bind(input.organizationId, input.wallet.programId).first<StoredProgram>();
    if (!program) throw new WalletError('El programa de wallet no pertenece a la organización.', 404, 'wallet_program_not_found');
    if (program.status !== 'active') throw new WalletError('El programa de wallet no está activo.', 409, 'wallet_program_inactive');
    const customer = await database.prepare(
      'SELECT id, name, country, status FROM customers WHERE organization_id = ? AND id = ? LIMIT 1',
    ).bind(input.organizationId, input.wallet.customerId).first<{ id: string; name: string; country: string; status: string }>();
    if (!customer) throw new WalletError('El cliente no pertenece a la organización.', 404, 'customer_not_found');
    if (customer.status !== 'active') throw new WalletError('El cliente debe estar activo para abrir una wallet.', 409, 'customer_inactive');
    try {
      await assertCustomerDueDiligenceApproved(input.organizationId, input.wallet.customerId, database);
    } catch (error) {
      if (error instanceof DueDiligenceError) {
        throw new WalletError(error.message, error.status, error.code);
      }
      throw error;
    }
    const duplicate = await database.prepare(
      'SELECT id FROM wallets WHERE organization_id = ? AND program_id = ? AND customer_id = ? LIMIT 1',
    ).bind(input.organizationId, input.wallet.programId, input.wallet.customerId).first<{ id: string }>();
    if (duplicate) throw new WalletError('El cliente ya tiene una wallet en este programa.', 409, 'wallet_already_exists');

    const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
    const serializedProgram = serializeProgram(program);
    await database.prepare(
      `INSERT INTO wallets
        (id, organization_id, program_id, customer_id, idempotency_key, request_fingerprint, external_reference,
         status, status_reason, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'issued', ?, ?, ?)`,
    ).bind(id, input.organizationId, input.wallet.programId, input.wallet.customerId, input.idempotencyKey,
      requestFingerprint, input.wallet.externalReference, input.actor.userId, createdAt, createdAt).run();
    await insertLifecycle(database, { organizationId: input.organizationId, walletId: id, idempotencyKey: input.idempotencyKey,
      requestFingerprint, fromStatus: null, toStatus: 'active', reason: 'issued', actorId: input.actor.userId, createdAt });

    for (const kind of serializedProgram.pocketKinds) {
      const accountId = crypto.randomUUID();
      const accountReference = `${customer.country}-${serializedProgram.defaultCurrency}-W${kind.slice(0, 3).toUpperCase()}${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0').slice(-10)}`;
      const ledgerAccountId = await createProductLedgerAccount({
        organizationId: input.organizationId, accountId, currency: serializedProgram.defaultCurrency,
        name: `Wallet ${accountReference}`,
      }, database);
      await database.prepare(
        `INSERT INTO accounts
          (id, organization_id, idempotency_key, customer_id, ledger_account_id, currency, country, account_reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).bind(accountId, input.organizationId, `${input.idempotencyKey}:${kind}`, customer.id, ledgerAccountId,
        serializedProgram.defaultCurrency, customer.country, accountReference, createdAt).run();
      await database.prepare(
        `INSERT INTO wallet_pockets (id, organization_id, wallet_id, account_id, kind, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), input.organizationId, id, accountId, kind, POCKET_LABELS[kind], createdAt).run();
    }

    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'wallet.created',
      resourceType: 'wallet', resourceId: id, payload: { programId: input.wallet.programId, customerId: input.wallet.customerId,
        externalReference: input.wallet.externalReference, pocketKinds: serializedProgram.pocketKinds } });
    const wallet = await retrieveWallet(input.organizationId, id, database);
    if (!wallet) throw new WalletError('No pudimos recuperar la wallet.', 500, 'wallet_create_failed');
    return { wallet, pockets: await listWalletPockets(input.organizationId, id, database), replayed: false };
  });
}

const lifecycleEvents: Record<string, string> = {
  frozen: 'wallet.frozen',
  active: 'wallet.unfrozen',
  closed: 'wallet.closed',
};

export async function transitionWalletStatus(input: {
  organizationId: string; actor: AuthUser; walletId: string; idempotencyKey: string; value: unknown;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:wallet-lifecycle:${input.idempotencyKey}`).first();
    const existingEvent = await database.prepare(
      `SELECT e.id, e.wallet_id AS "walletId", e.from_status AS "fromStatus", e.to_status AS "toStatus",
        e.reason, e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt",
        e.request_fingerprint AS "requestFingerprint"
       FROM wallet_lifecycle_events e JOIN users u ON u.id = e.actor_id
       WHERE e.organization_id = ? AND e.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<WalletLifecycleEvent & { requestFingerprint: string }>();
    const wallet = await database.prepare(
      'SELECT id, status FROM wallets WHERE organization_id = ? AND id = ? FOR UPDATE',
    ).bind(input.organizationId, input.walletId).first<{ id: string; status: WalletStatus }>();
    if (!wallet) throw new WalletError('Wallet no encontrada.', 404, 'wallet_not_found');
    const transition = normalizeWalletTransition(input.value, wallet.status);
    if (!transition) throw new WalletError('La transición de wallet no es válida para el estado actual.', 409, 'invalid_wallet_transition');
    const requestFingerprint = await sha256(JSON.stringify(transition));
    if (existingEvent) {
      if (existingEvent.walletId !== input.walletId || existingEvent.requestFingerprint !== requestFingerprint) {
        throw new WalletError('La Idempotency-Key ya fue usada con otra transición.', 409, 'idempotency_mismatch');
      }
      const { requestFingerprint: _fingerprint, ...event } = existingEvent; void _fingerprint;
      return { event, replayed: true };
    }

    const pockets = await database.prepare(
      `SELECT wp.id, a.ledger_account_id AS "ledgerAccountId", a.id AS "accountId"
       FROM wallet_pockets wp JOIN accounts a ON a.id = wp.account_id
       WHERE wp.organization_id = ? AND wp.wallet_id = ? ORDER BY a.ledger_account_id FOR UPDATE OF a`,
    ).bind(input.organizationId, input.walletId).all<{ id: string; ledgerAccountId: string; accountId: string }>();
    if (transition.status === 'closed') {
      for (const pocket of pockets.results) {
        const [current, held] = await Promise.all([
          accountBalanceMinor(pocket.ledgerAccountId, database), activeHoldsMinor(pocket.ledgerAccountId, database),
        ]);
        if (held > 0n) throw new WalletError('No se puede cerrar una wallet con reservas activas.', 409, 'wallet_has_holds');
        if (current !== 0n) throw new WalletError('Transferí el saldo de todos los bolsillos antes de cerrar la wallet.', 409, 'wallet_has_balance');
      }
    }

    const createdAt = new Date().toISOString();
    await database.prepare(
      'UPDATE wallets SET status = ?, status_reason = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
    ).bind(transition.status, transition.reason, createdAt, input.organizationId, input.walletId).run();
    const accountStatus = accountStatusForWallet(transition.status);
    for (const pocket of pockets.results) {
      await database.prepare('UPDATE accounts SET status = ? WHERE id = ? AND organization_id = ?')
        .bind(accountStatus, pocket.accountId, input.organizationId).run();
    }
    await insertLifecycle(database, { organizationId: input.organizationId, walletId: input.walletId,
      idempotencyKey: input.idempotencyKey, requestFingerprint, fromStatus: wallet.status, toStatus: transition.status,
      reason: transition.reason, actorId: input.actor.userId, createdAt });
    const action = lifecycleEvents[transition.status] ?? 'wallet.unfrozen';
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action,
      resourceType: 'wallet', resourceId: input.walletId, payload: { fromStatus: wallet.status, toStatus: transition.status,
        reason: transition.reason } });
    const events = await database.prepare(
      `SELECT e.id, e.wallet_id AS "walletId", e.from_status AS "fromStatus", e.to_status AS "toStatus",
        e.reason, e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt"
       FROM wallet_lifecycle_events e JOIN users u ON u.id = e.actor_id
       WHERE e.organization_id = ? AND e.idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<WalletLifecycleEvent>();
    if (!events) throw new WalletError('No pudimos recuperar el evento de lifecycle.', 500, 'wallet_transition_failed');
    return { event: events, replayed: false };
  });
}

export async function createWalletPocketTransfer(input: {
  organizationId: string; actor: AuthUser; walletId: string; idempotencyKey: string;
  transfer: NormalizedWalletPocketTransferInput; signals?: ProtectedRiskSignals;
  authentication: 'session' | 'api_key'; apiKeyId: string | null;
}) {
  const database = getDatabaseClient();
  const wallet = await database.prepare(
    'SELECT id, status FROM wallets WHERE organization_id = ? AND id = ? LIMIT 1',
  ).bind(input.organizationId, input.walletId).first<{ id: string; status: WalletStatus }>();
  if (!wallet) throw new WalletError('Wallet no encontrada.', 404, 'wallet_not_found');
  if (wallet.status !== 'active') throw new WalletError('La wallet debe estar activa para mover saldo entre bolsillos.', 409, 'wallet_inactive');
  const pockets = await database.prepare(
    `SELECT wp.id, wp.account_id AS "accountId", a.currency, a.status
     FROM wallet_pockets wp JOIN accounts a ON a.id = wp.account_id
     WHERE wp.organization_id = ? AND wp.wallet_id = ? AND wp.id IN (?, ?)`,
  ).bind(input.organizationId, input.walletId, input.transfer.sourcePocketId, input.transfer.destinationPocketId)
    .all<{ id: string; accountId: string; currency: Currency; status: string }>();
  const source = pockets.results.find((pocket) => pocket.id === input.transfer.sourcePocketId);
  const destination = pockets.results.find((pocket) => pocket.id === input.transfer.destinationPocketId);
  if (!source || !destination) throw new WalletError('Ambos bolsillos deben pertenecer a la misma wallet.', 404, 'pocket_not_found');
  if (source.currency !== input.transfer.currency || destination.currency !== input.transfer.currency) {
    throw new WalletError('Los bolsillos deben usar la moneda del movimiento.', 409, 'currency_mismatch');
  }
  try {
    const result = await createBookTransferWithApprovalPolicy({
      organizationId: input.organizationId, actor: input.actor, idempotencyKey: input.idempotencyKey,
      externalReference: input.transfer.externalReference, sourceAccountId: source.accountId,
      destinationAccountId: destination.accountId, description: input.transfer.description,
      amountMinor: input.transfer.amountMinor, currency: input.transfer.currency, signals: input.signals,
      authentication: input.authentication, apiKeyId: input.apiKeyId,
    });
    const envelope = { ...result, walletId: input.walletId, sourcePocketId: source.id, destinationPocketId: destination.id };
    if (result.requiresApproval || 'declined' in result || result.replayed || !('transfer' in result)) return envelope;
    await getDatabaseClient().transaction(async (tx) => {
      await audit(tx, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'wallet.pocket_transfer_created',
        resourceType: 'wallet', resourceId: input.walletId, payload: { transferId: result.transfer.id, sourcePocketId: source.id,
          destinationPocketId: destination.id } });
    });
    return envelope;
  } catch (error) {
    if (error instanceof BookTransferError || error instanceof ApprovalError) throw error;
    throw error;
  }
}
