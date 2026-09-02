import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import {
  isSandboxCvu, issueSandboxCvu, namesMatch, railLast4,
} from '@/app/lib/platform/cbu';
import { aliasChangeBlocked } from '@/app/lib/platform/instant-payments-input';
import type {
  CounterpartyKind, NormalizedAssignAliasInput, NormalizedDebitRequestInput, NormalizedDebitResponse, NormalizedInstantTransferInput,
  NormalizedIssueInstrumentInput, NormalizedPaymentQrInput, NormalizedQrPayInput, NormalizedQrSaleOrderInput, RailScheme,
} from '@/app/lib/platform/instant-payments-input';
import { assertSandboxLedgerOrCertifiedRail } from './platform-rails';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import {
  accountBalanceMinor, activeHoldsMinor, createAccountPaymentInTransaction, insertAudit, LedgerError, postJournal,
  reverseTransactionInTransaction,
} from './ledger';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

export class InstantPaymentError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'instant_payment_error') { super(message); }
}

type AccountRow = {
  id: string; ledgerAccountId: string; accountReference: string; customerName: string;
  taxIdLast4: string; currency: Currency; country: string; status: string;
};

type InstrumentRow = {
  id: string; accountId: string; accountReference: string; customerName: string; kind: 'cvu' | 'alias';
  value: string; holderName: string; taxIdLast4: string; status: string; requestFingerprint: string;
  valueChangedAt: string | null; createdAt: string;
};

type TransferRow = {
  id: string; scheme: RailScheme; direction: string; sourceAccountId: string | null; sourceAccountReference: string | null;
  destinationAccountId: string | null; destinationAccountReference: string | null; counterpartyKind: CounterpartyKind;
  counterpartyHash: string; counterpartyLast4: string; counterpartyHolderName: string | null; counterpartyTaxLast4: string | null;
  amountMinor: string; currency: Currency; description: string; externalReference: string; status: string; rail: string;
  transactionId: string | null; reversalTransactionId: string | null; qrPayload: string | null; expiresAt: string | null;
  requestFingerprint: string; createdAt: string; updatedAt: string;
};

type QrRow = {
  id: string; accountId: string; accountReference: string; amountMinor: string | null; currency: Currency;
  description: string; payload: string; kind: 'dynamic' | 'static'; status: string; expiresAt: string | null;
  paidTransferId: string | null; requestFingerprint: string; createdAt: string; updatedAt: string;
};

type SaleOrderRow = {
  id: string; paymentQrId: string; qrPayload: string; accountId: string; accountReference: string;
  amountMinor: string; currency: Currency; description: string; externalReference: string; status: string;
  expiresAt: string; paidTransferId: string | null; requestFingerprint: string; createdAt: string; updatedAt: string;
};

const instrumentSelect = `SELECT ri.id, ri.account_id AS "accountId", a.account_reference AS "accountReference",
  c.name AS "customerName", ri.kind, ri.value, ri.holder_name AS "holderName", ri.tax_id_last4 AS "taxIdLast4",
  ri.status, ri.request_fingerprint AS "requestFingerprint", ri.value_changed_at AS "valueChangedAt", ri.created_at AS "createdAt"
  FROM rail_instruments ri JOIN accounts a ON a.id = ri.account_id JOIN customers c ON c.id = a.customer_id`;

const transferSelect = `SELECT it.id, it.scheme, it.direction, it.source_account_id AS "sourceAccountId",
  source.account_reference AS "sourceAccountReference", it.destination_account_id AS "destinationAccountId",
  dest.account_reference AS "destinationAccountReference", it.counterparty_kind AS "counterpartyKind",
  it.counterparty_hash AS "counterpartyHash", it.counterparty_last4 AS "counterpartyLast4",
  it.counterparty_holder_name AS "counterpartyHolderName", it.counterparty_tax_last4 AS "counterpartyTaxLast4",
  it.amount_minor::text AS "amountMinor", it.currency, it.description, it.external_reference AS "externalReference",
  it.status, it.rail, it.transaction_id AS "transactionId", it.reversal_transaction_id AS "reversalTransactionId",
  it.qr_payload AS "qrPayload", it.expires_at AS "expiresAt", it.request_fingerprint AS "requestFingerprint",
  it.created_at AS "createdAt", it.updated_at AS "updatedAt"
  FROM instant_transfers it
  LEFT JOIN accounts source ON source.id = it.source_account_id
  LEFT JOIN accounts dest ON dest.id = it.destination_account_id`;

const qrSelect = `SELECT q.id, q.account_id AS "accountId", a.account_reference AS "accountReference",
  q.amount_minor::text AS "amountMinor", q.currency, q.description, q.payload, q.kind, q.status, q.expires_at AS "expiresAt",
  q.paid_transfer_id AS "paidTransferId", q.request_fingerprint AS "requestFingerprint",
  q.created_at AS "createdAt", q.updated_at AS "updatedAt"
  FROM payment_qrs q JOIN accounts a ON a.id = q.account_id`;

const saleOrderSelect = `SELECT so.id, so.payment_qr_id AS "paymentQrId", q.payload AS "qrPayload",
  q.account_id AS "accountId", a.account_reference AS "accountReference", so.amount_minor::text AS "amountMinor",
  so.currency, so.description, so.external_reference AS "externalReference", so.status, so.expires_at AS "expiresAt",
  so.paid_transfer_id AS "paidTransferId", so.request_fingerprint AS "requestFingerprint",
  so.created_at AS "createdAt", so.updated_at AS "updatedAt"
  FROM qr_sale_orders so
  JOIN payment_qrs q ON q.id = so.payment_qr_id
  JOIN accounts a ON a.id = q.account_id`;

function serializeInstrument(row: InstrumentRow) {
  const { requestFingerprint: _fingerprint, valueChangedAt: _changed, ...publicRow } = row;
  void _fingerprint; void _changed;
  return { ...publicRow, last4: railLast4(row.value) };
}

function serializeTransfer(row: TransferRow) {
  const { requestFingerprint: _fingerprint, counterpartyHash: _hash, ...publicRow } = row;
  void _fingerprint; void _hash;
  return { ...publicRow, amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency) };
}

function serializeQr(row: QrRow) {
  const { requestFingerprint: _fingerprint, ...publicRow } = row; void _fingerprint;
  return {
    ...publicRow,
    amount: row.amountMinor === null ? null : minorToMajorNumber(BigInt(row.amountMinor), row.currency),
  };
}

function serializeSaleOrder(row: SaleOrderRow) {
  const { requestFingerprint: _fingerprint, ...publicRow } = row; void _fingerprint;
  return { ...publicRow, amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency) };
}

async function expireStaleSaleOrders(database: DatabaseClient, organizationId: string, paymentQrId?: string) {
  const now = new Date().toISOString();
  if (paymentQrId) {
    await database.prepare(
      "UPDATE qr_sale_orders SET status = 'expired', updated_at = ? WHERE organization_id = ? AND payment_qr_id = ? AND status = 'pending' AND expires_at <= ?",
    ).bind(now, organizationId, paymentQrId, now).run();
    return;
  }
  await database.prepare(
    "UPDATE qr_sale_orders SET status = 'expired', updated_at = ? WHERE organization_id = ? AND status = 'pending' AND expires_at <= ?",
  ).bind(now, organizationId, now).run();
}

async function loadAccount(database: DatabaseClient, organizationId: string, accountId: string, lock = false) {
  const row = await database.prepare(
    `SELECT a.id, a.ledger_account_id AS "ledgerAccountId", a.account_reference AS "accountReference",
      c.name AS "customerName", c.tax_id_last4 AS "taxIdLast4", a.currency, a.country, a.status
     FROM accounts a JOIN customers c ON c.id = a.customer_id
     WHERE a.organization_id = ? AND a.id = ? LIMIT 1 ${lock ? 'FOR UPDATE OF a' : ''}`,
  ).bind(organizationId, accountId).first<AccountRow>();
  return row;
}

function assertArsAccount(account: AccountRow | null): asserts account is AccountRow {
  if (!account) throw new InstantPaymentError('Cuenta no encontrada.', 404, 'account_not_found');
  if (account.status !== 'active') throw new InstantPaymentError('La cuenta no está activa.', 409, 'account_inactive');
  if (account.currency !== 'ARS') throw new InstantPaymentError('Los pagos instantáneos del sandbox operan sólo en ARS.', 409, 'currency_mismatch');
}

async function findInstrumentByValue(database: DatabaseClient, organizationId: string, value: string) {
  return database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.value = ? AND ri.status = 'active' LIMIT 1`)
    .bind(organizationId, value).first<InstrumentRow>();
}

async function retrieveTransferRow(organizationId: string, id: string, database: DatabaseClient) {
  return database.prepare(`${transferSelect} WHERE it.organization_id = ? AND it.id = ? LIMIT 1`)
    .bind(organizationId, id).first<TransferRow>();
}

export async function listRailInstruments(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (ri.created_at, ri.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${instrumentSelect} WHERE ri.organization_id = ? ${clause} ORDER BY ri.created_at DESC, ri.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<InstrumentRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<InstrumentRow>();
  return rows.results.map(serializeInstrument);
}

export async function retrieveRailInstrument(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.id = ? LIMIT 1`)
    .bind(organizationId, id).first<InstrumentRow>();
  return row ? serializeInstrument(row) : null;
}

export async function lookupRailDirectory(organizationId: string, destination: { kind: CounterpartyKind; value: string }) {
  await assertSandboxLedgerOrCertifiedRail('account_lookup', InstantPaymentError);
  const found = await findInstrumentByValue(getDatabaseClient(), organizationId, destination.value);
  if (found) {
    return {
      found: true as const, kind: found.kind, last4: railLast4(found.value), holderName: found.holderName,
      taxIdLast4: found.taxIdLast4, rail: 'cimbra_sandbox' as const,
    };
  }
  if (destination.kind === 'alias') {
    return { found: false as const, kind: destination.kind, last4: railLast4(destination.value), holderName: null, taxIdLast4: null, rail: 'cimbra_sandbox' as const };
  }
  if (isSandboxCvu(destination.value)) {
    return { found: false as const, kind: destination.kind, last4: railLast4(destination.value), holderName: null, taxIdLast4: null, rail: 'cimbra_sandbox' as const };
  }
  return {
    found: false as const, kind: destination.kind, last4: railLast4(destination.value), holderName: null, taxIdLast4: null, rail: 'external_preview' as const,
  };
}

export async function issueRailInstruments(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; instrument: NormalizedIssueInstrumentInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('cvu', InstantPaymentError);
  const requestFingerprint = await sha256(JSON.stringify(input.instrument));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:rail-instrument:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<InstrumentRow>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otra emisión.', 409, 'idempotency_mismatch');
      }
      const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
        .bind(input.organizationId, existing.accountId).all<InstrumentRow>();
      return { instruments: instruments.results.map(serializeInstrument), replayed: true };
    }
    const account = await loadAccount(database, input.organizationId, input.instrument.accountId, true);
    assertArsAccount(account);
    if (account.country !== 'AR') {
      throw new InstantPaymentError('El CVU sandbox sólo se emite para cuentas argentinas.', 409, 'country_mismatch');
    }
    const existingCvu = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? AND ri.kind = 'cvu' LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, account.id).first<InstrumentRow>();
    if (existingCvu && existingCvu.status === 'active') {
      throw new InstantPaymentError('La cuenta ya tiene un CVU sandbox.', 409, 'cvu_already_issued');
    }
    if (input.instrument.alias) {
      const taken = await database.prepare(
        "SELECT id FROM rail_instruments WHERE organization_id = ? AND value = ? AND account_id <> ? LIMIT 1",
      ).bind(input.organizationId, input.instrument.alias, account.id).first<{ id: string }>();
      if (taken) throw new InstantPaymentError('El alias ya está asignado en este tenant.', 409, 'alias_conflict');
    }
    const cvu = issueSandboxCvu(account.id);
    const createdAt = new Date().toISOString();
    const cvuId = existingCvu?.id ?? crypto.randomUUID();
    if (existingCvu) {
      await database.prepare(`UPDATE rail_instruments
        SET idempotency_key = ?, request_fingerprint = ?, status = 'active', revoke_idempotency_key = NULL, updated_at = ?
        WHERE id = ?`).bind(input.idempotencyKey, requestFingerprint, createdAt, existingCvu.id).run();
    } else {
      await database.prepare(`INSERT INTO rail_instruments
        (id, organization_id, account_id, idempotency_key, request_fingerprint, kind, value, holder_name, tax_id_last4, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'cvu', ?, ?, ?, 'active', ?, ?, ?)`).bind(
        cvuId, input.organizationId, account.id, input.idempotencyKey, requestFingerprint, cvu,
        account.customerName, account.taxIdLast4, input.actor.userId, createdAt, createdAt,
      ).run();
    }
    const issued = [serializeInstrument({
      id: cvuId, accountId: account.id, accountReference: account.accountReference, customerName: account.customerName,
      kind: 'cvu', value: cvu, holderName: account.customerName, taxIdLast4: account.taxIdLast4, status: 'active',
      requestFingerprint, valueChangedAt: null, createdAt: existingCvu?.createdAt ?? createdAt,
    })];
    if (input.instrument.alias) {
      const existingAlias = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? AND ri.kind = 'alias' LIMIT 1 FOR UPDATE OF ri`)
        .bind(input.organizationId, account.id).first<InstrumentRow>();
      if (existingAlias) {
        await database.prepare(`UPDATE rail_instruments
          SET value = ?, idempotency_key = ?, request_fingerprint = ?, status = 'active', value_changed_at = NULL, updated_at = ?
          WHERE id = ?`).bind(input.instrument.alias, `${input.idempotencyKey}:alias`, requestFingerprint, createdAt, existingAlias.id).run();
        issued.push(serializeInstrument({
          id: existingAlias.id, accountId: account.id, accountReference: account.accountReference, customerName: account.customerName,
          kind: 'alias', value: input.instrument.alias, holderName: account.customerName, taxIdLast4: account.taxIdLast4,
          status: 'active', requestFingerprint, valueChangedAt: null, createdAt: existingAlias.createdAt,
        }));
      } else {
        const aliasId = crypto.randomUUID();
        await database.prepare(`INSERT INTO rail_instruments
          (id, organization_id, account_id, idempotency_key, request_fingerprint, kind, value, holder_name, tax_id_last4, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'alias', ?, ?, ?, 'active', ?, ?, ?)`).bind(
          aliasId, input.organizationId, account.id, `${input.idempotencyKey}:alias`, requestFingerprint, input.instrument.alias,
          account.customerName, account.taxIdLast4, input.actor.userId, createdAt, createdAt,
        ).run();
        issued.push(serializeInstrument({
          id: aliasId, accountId: account.id, accountReference: account.accountReference, customerName: account.customerName,
          kind: 'alias', value: input.instrument.alias, holderName: account.customerName, taxIdLast4: account.taxIdLast4,
          status: 'active', requestFingerprint, valueChangedAt: null, createdAt,
        }));
      }
    }
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'rail.instrument_issued',
      resourceType: 'rail_instrument', resourceId: cvuId,
      payload: { accountId: account.id, kinds: issued.map((item) => item.kind), last4: railLast4(cvu) },
    });
    return { instruments: issued, replayed: false };
  });
}

export async function assignRailAlias(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; instrumentId: string; alias: NormalizedAssignAliasInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('cvu', InstantPaymentError);
  const requestFingerprint = await sha256(JSON.stringify({ instrumentId: input.instrumentId, alias: input.alias.alias }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:rail-alias-assign:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.assign_idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<InstrumentRow>();
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otro alias.', 409, 'idempotency_mismatch');
      }
      const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
        .bind(input.organizationId, replay.accountId).all<InstrumentRow>();
      return { instruments: instruments.results.map(serializeInstrument), replayed: true };
    }
    const target = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.id = ? LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, input.instrumentId).first<InstrumentRow>();
    if (!target) throw new InstantPaymentError('Instrumento no encontrado.', 404, 'rail_instrument_not_found');
    if (target.status !== 'active') throw new InstantPaymentError('El instrumento no está activo.', 409, 'rail_instrument_inactive');
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:rail-alias:${target.accountId}`).first();
    const cvu = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? AND ri.kind = 'cvu' LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, target.accountId).first<InstrumentRow>();
    if (!cvu || cvu.status !== 'active') {
      throw new InstantPaymentError('No existe un CVU activo para asignar el alias.', 422, 'cvu_not_found');
    }
    const taken = await database.prepare(
      "SELECT id FROM rail_instruments WHERE organization_id = ? AND value = ? AND account_id <> ? LIMIT 1",
    ).bind(input.organizationId, input.alias.alias, target.accountId).first<{ id: string }>();
    if (taken) throw new InstantPaymentError('El alias ya está asignado en este tenant.', 422, 'alias_conflict');
    const now = new Date().toISOString();
    const existingAlias = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? AND ri.kind = 'alias' LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, target.accountId).first<InstrumentRow>();
    if (existingAlias && existingAlias.status === 'active' && existingAlias.value === input.alias.alias) {
      const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
        .bind(input.organizationId, target.accountId).all<InstrumentRow>();
      return { instruments: instruments.results.map(serializeInstrument), replayed: false };
    }
    if (existingAlias?.status === 'active' && aliasChangeBlocked(existingAlias.valueChangedAt)) {
      throw new InstantPaymentError('El alias no puede modificarse más de una vez en 24 horas.', 422, 'alias_change_rate_limited');
    }
    if (existingAlias) {
      const changingActive = existingAlias.status === 'active' && existingAlias.value !== input.alias.alias;
      await database.prepare(`UPDATE rail_instruments
        SET value = ?, request_fingerprint = ?, assign_idempotency_key = ?, value_changed_at = ?, status = 'active', updated_at = ?
        WHERE id = ?`).bind(
        input.alias.alias, requestFingerprint, input.idempotencyKey, changingActive ? now : null, now, existingAlias.id,
      ).run();
    } else {
      const aliasId = crypto.randomUUID();
      await database.prepare(`INSERT INTO rail_instruments
        (id, organization_id, account_id, idempotency_key, request_fingerprint, kind, value, holder_name, tax_id_last4,
         status, assign_idempotency_key, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'alias', ?, ?, ?, 'active', ?, ?, ?, ?)`).bind(
        aliasId, input.organizationId, target.accountId, `alias-assign:${input.idempotencyKey}`, requestFingerprint,
        input.alias.alias, cvu.holderName, cvu.taxIdLast4, input.idempotencyKey, input.actor.userId, now, now,
      ).run();
    }
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'rail.alias_assigned',
      resourceType: 'rail_instrument', resourceId: cvu.id,
      payload: { accountId: target.accountId, aliasLast4: railLast4(input.alias.alias), previousLast4: existingAlias ? railLast4(existingAlias.value) : null },
    });
    const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
      .bind(input.organizationId, target.accountId).all<InstrumentRow>();
    return { instruments: instruments.results.map(serializeInstrument), replayed: false };
  });
}

export async function revokeRailInstrument(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; instrumentId: string;
}) {
  await assertSandboxLedgerOrCertifiedRail('cvu', InstantPaymentError);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:rail-instrument-revoke:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.revoke_idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<InstrumentRow>();
    if (replay) {
      const target = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.id = ? LIMIT 1`)
        .bind(input.organizationId, input.instrumentId).first<InstrumentRow>();
      if (target && target.accountId !== replay.accountId) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otro instrumento.', 409, 'idempotency_mismatch');
      }
      const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
        .bind(input.organizationId, replay.accountId).all<InstrumentRow>();
      return { instruments: instruments.results.map(serializeInstrument), replayed: true };
    }
    const target = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.id = ? LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, input.instrumentId).first<InstrumentRow>();
    if (!target) throw new InstantPaymentError('Instrumento no encontrado.', 404, 'rail_instrument_not_found');
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:rail-alias:${target.accountId}`).first();
    const cvu = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? AND ri.kind = 'cvu' LIMIT 1 FOR UPDATE OF ri`)
      .bind(input.organizationId, target.accountId).first<InstrumentRow>();
    if (!cvu) throw new InstantPaymentError('No existe un CVU para eliminar.', 422, 'cvu_not_found');
    if (cvu.status !== 'active') throw new InstantPaymentError('El CVU ya fue eliminado. La cuenta y el saldo no se tocan.', 409, 'rail_instrument_inactive');
    const now = new Date().toISOString();
    await database.prepare(`UPDATE rail_instruments SET status = 'revoked', updated_at = ?
      WHERE organization_id = ? AND account_id = ? AND status = 'active'`).bind(
      now, input.organizationId, target.accountId,
    ).run();
    await database.prepare(`UPDATE rail_instruments SET revoke_idempotency_key = ?, updated_at = ? WHERE id = ?`)
      .bind(input.idempotencyKey, now, cvu.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'rail.instrument_revoked',
      resourceType: 'rail_instrument', resourceId: cvu.id,
      payload: { accountId: target.accountId, last4: railLast4(cvu.value) },
    });
    const instruments = await database.prepare(`${instrumentSelect} WHERE ri.organization_id = ? AND ri.account_id = ? ORDER BY ri.kind`)
      .bind(input.organizationId, target.accountId).all<InstrumentRow>();
    return { instruments: instruments.results.map(serializeInstrument), replayed: false };
  });
}

export async function listInstantTransfers(input: {
  organizationId: string; limit: number; scheme?: RailScheme; cursor?: { createdAt: string; id: string };
}) {
  const schemeClause = input.scheme ? 'AND it.scheme = ?' : '';
  const cursorClause = input.cursor ? 'AND (it.created_at, it.id) < (?, ?)' : '';
  const sql = `${transferSelect} WHERE it.organization_id = ? ${schemeClause} ${cursorClause} ORDER BY it.created_at DESC, it.id DESC LIMIT ?`;
  const statement = getDatabaseClient().prepare(sql);
  const rows = input.scheme && input.cursor
    ? await statement.bind(input.organizationId, input.scheme, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<TransferRow>()
    : input.scheme
      ? await statement.bind(input.organizationId, input.scheme, input.limit + 1).all<TransferRow>()
      : input.cursor
        ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<TransferRow>()
        : await statement.bind(input.organizationId, input.limit + 1).all<TransferRow>();
  return rows.results.map(serializeTransfer);
}

export async function retrieveInstantTransfer(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await retrieveTransferRow(organizationId, id, database);
  return row ? serializeTransfer(row) : null;
}

async function insertTransfer(database: DatabaseClient, input: {
  id: string; organizationId: string; idempotencyKey: string; fingerprint: string; scheme: RailScheme; direction: string;
  sourceAccountId: string | null; destinationAccountId: string | null; counterpartyKind: CounterpartyKind; counterpartyValue: string;
  holderName: string | null; taxIdLast4: string | null; amountMinor: bigint; description: string; externalReference: string;
  status: string; transactionId: string | null; qrPayload: string | null; expiresAt: string | null; actorId: string; createdAt: string;
}) {
  const hash = await sha256(input.counterpartyValue);
  await database.prepare(`INSERT INTO instant_transfers
    (id, organization_id, idempotency_key, request_fingerprint, scheme, direction, source_account_id, destination_account_id,
     counterparty_kind, counterparty_hash, counterparty_last4, counterparty_holder_name, counterparty_tax_last4,
     amount_minor, currency, description, external_reference, status, rail, transaction_id, reversal_transaction_id,
     qr_payload, expires_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, 'cimbra_sandbox', ?, NULL, ?, ?, ?, ?, ?)`).bind(
    input.id, input.organizationId, input.idempotencyKey, input.fingerprint, input.scheme, input.direction,
    input.sourceAccountId, input.destinationAccountId, input.counterpartyKind, hash, railLast4(input.counterpartyValue),
    input.holderName, input.taxIdLast4, input.amountMinor.toString(), input.description, input.externalReference,
    input.status, input.transactionId, input.qrPayload, input.expiresAt, input.actorId, input.createdAt, input.createdAt,
  ).run();
}

async function postInternalMovement(database: DatabaseClient, input: {
  organizationId: string; actor: AuthUser; operationKey: string; source: AccountRow; destination: AccountRow;
  amountMinor: bigint; description: string; counterparty: string; signals?: ProtectedRiskSignals;
}) {
  const [current, held] = await Promise.all([
    accountBalanceMinor(input.source.ledgerAccountId, database), activeHoldsMinor(input.source.ledgerAccountId, database),
  ]);
  if (input.amountMinor > current - held) {
    throw new InstantPaymentError('Saldo disponible insuficiente en la cuenta de origen.', 422, 'insufficient_funds');
  }
  let assessment;
  try {
    assessment = await assessRisk({
      organizationId: input.organizationId, idempotencyKey: input.operationKey, operationType: 'transfer',
      amountMinor: input.amountMinor, currency: 'ARS', counterparty: input.counterparty, signals: input.signals,
    }, database);
  } catch (error) {
    if (error instanceof RiskError) throw new InstantPaymentError(error.message, error.status, error.code);
    throw error;
  }
  if (assessment.decision === 'decline') {
    const declined = await persistRiskAssessment({
      organizationId: input.organizationId, idempotencyKey: input.operationKey, actor: input.actor, assessment,
    }, database);
    return { declined, replayed: declined.replayed };
  }
  const transactionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = assessment.decision === 'review' ? 'review' : 'settled';
  await database.prepare(`INSERT INTO transactions
    (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score,
     reversal_of, created_at, updated_at) VALUES (?, ?, ?, 'instant_transfer', ?, ?, ?, 'ARS', ?, ?, NULL, ?, ?)`)
    .bind(transactionId, input.organizationId, input.operationKey, input.counterparty, input.description,
      (-input.amountMinor).toString(), status, assessment.score, now, now).run();
  let holdId: string | null = null;
  if (status === 'review') {
    holdId = crypto.randomUUID();
    await database.prepare(`INSERT INTO holds
      (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ARS', 'active', ?, ?, ?)`)
      .bind(holdId, input.organizationId, input.source.ledgerAccountId, transactionId, input.operationKey,
        input.amountMinor.toString(), new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), now, now).run();
  } else {
    await postJournal({
      organizationId: input.organizationId, transactionId, idempotencyKey: input.operationKey, kind: 'instant_transfer',
      description: input.description, currency: 'ARS', createdAt: now,
      postings: [
        { accountId: input.source.ledgerAccountId, direction: 'debit', amountMinor: input.amountMinor },
        { accountId: input.destination.ledgerAccountId, direction: 'credit', amountMinor: input.amountMinor },
      ],
    }, database);
  }
  await persistRiskAssessment({
    organizationId: input.organizationId, idempotencyKey: input.operationKey, actor: input.actor, assessment,
    resourceId: transactionId, holdId,
  }, database);
  return { transactionId, status: status === 'review' ? 'pending' : 'settled', replayed: false as const };
}

export async function createInstantTransfer(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string;
  transfer: NormalizedInstantTransferInput; signals?: ProtectedRiskSignals;
}) {
  await assertSandboxLedgerOrCertifiedRail('transfers', InstantPaymentError);
  const fingerprint = await sha256(JSON.stringify({
    ...input.transfer, amountMinor: input.transfer.amountMinor.toString(), signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${transferSelect} WHERE it.organization_id = ? AND it.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<TransferRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otra transferencia instantánea.', 409, 'idempotency_mismatch');
      }
      return { transfer: serializeTransfer(existing), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant-ref:${input.transfer.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM instant_transfers WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.transfer.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new InstantPaymentError('La referencia externa ya pertenece a otra transferencia instantánea.', 409, 'external_reference_conflict');

    const account = await loadAccount(database, input.organizationId, input.transfer.accountId, true);
    assertArsAccount(account);
    const destination = input.transfer.destination;
    const local = await findInstrumentByValue(database, input.organizationId, destination.value);

    if (destination.kind === 'alias' && !local) {
      throw new InstantPaymentError('El alias no existe en este tenant. El sandbox no consulta el directorio nacional.', 404, 'alias_not_found');
    }
    if (destination.kind === 'cvu' && isSandboxCvu(destination.value) && !local) {
      throw new InstantPaymentError('El CVU sandbox no pertenece a este tenant.', 404, 'unknown_sandbox_cvu');
    }

    if (local) {
      if (!namesMatch(input.transfer.holderName, local.holderName) || input.transfer.taxIdLast4 !== local.taxIdLast4) {
        throw new InstantPaymentError('La confirmación de titular no coincide con el instrumento.', 422, 'holder_mismatch');
      }
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const operationKey = `instant:${input.idempotencyKey}`;

    if (input.transfer.direction === 'inbound') {
      if (local) throw new InstantPaymentError('Un crédito inbound sandbox debe originarse en un CBU/CVU externo.', 400, 'inbound_must_be_external');
      const ownCvu = await database.prepare(
        "SELECT id FROM rail_instruments WHERE organization_id = ? AND account_id = ? AND kind = 'cvu' AND status = 'active' LIMIT 1",
      ).bind(input.organizationId, account.id).first<{ id: string }>();
      if (!ownCvu) throw new InstantPaymentError('La cuenta destino no tiene un CVU sandbox emitido.', 409, 'cvu_required');
      let payment;
      try {
        payment = await createAccountPaymentInTransaction({
          organizationId: input.organizationId, actor: input.actor, idempotencyKey: `inbound-${input.idempotencyKey}`,
          accountId: account.id, direction: 'cash_in', counterparty: `${destination.kind}:${railLast4(destination.value)}`,
          description: input.transfer.description, amountMinor: input.transfer.amountMinor, currency: 'ARS', signals: input.signals,
        }, database);
      } catch (error) {
        if (error instanceof LedgerError) throw new InstantPaymentError(error.message, error.status, error.code);
        throw error;
      }
      if ('declined' in payment) return { declined: payment.declined, replayed: payment.replayed };
      await insertTransfer(database, {
        id, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, fingerprint, scheme: 'credit_push',
        direction: 'inbound', sourceAccountId: null, destinationAccountId: account.id, counterpartyKind: destination.kind,
        counterpartyValue: destination.value, holderName: input.transfer.holderName, taxIdLast4: input.transfer.taxIdLast4,
        amountMinor: input.transfer.amountMinor, description: input.transfer.description, externalReference: input.transfer.externalReference,
        status: payment.payment.status === 'review' ? 'pending' : 'settled', transactionId: payment.payment.id,
        qrPayload: null, expiresAt: null, actorId: input.actor.userId, createdAt,
      });
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.transfer_created',
        resourceType: 'instant_transfer', resourceId: id,
        payload: { scheme: 'credit_push', direction: 'inbound', status: payment.payment.status, amountMinor: input.transfer.amountMinor.toString() },
      });
      return { transfer: await retrieveInstantTransfer(input.organizationId, id, database), replayed: false };
    }

    if (local) {
      if (local.accountId === account.id) throw new InstantPaymentError('La cuenta de origen y destino deben ser diferentes.', 400, 'same_account');
      const destinationAccount = await loadAccount(database, input.organizationId, local.accountId, true);
      assertArsAccount(destinationAccount);
      const movement = await postInternalMovement(database, {
        organizationId: input.organizationId, actor: input.actor, operationKey, source: account, destination: destinationAccount,
        amountMinor: input.transfer.amountMinor, description: input.transfer.description,
        counterparty: `internal:${destinationAccount.accountReference}`, signals: input.signals,
      });
      if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
      await insertTransfer(database, {
        id, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, fingerprint, scheme: 'credit_push',
        direction: 'internal', sourceAccountId: account.id, destinationAccountId: destinationAccount.id,
        counterpartyKind: destination.kind, counterpartyValue: destination.value, holderName: local.holderName,
        taxIdLast4: local.taxIdLast4, amountMinor: input.transfer.amountMinor, description: input.transfer.description,
        externalReference: input.transfer.externalReference, status: movement.status, transactionId: movement.transactionId,
        qrPayload: null, expiresAt: null, actorId: input.actor.userId, createdAt,
      });
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.transfer_created',
        resourceType: 'instant_transfer', resourceId: id,
        payload: { scheme: 'credit_push', direction: 'internal', status: movement.status, amountMinor: input.transfer.amountMinor.toString() },
      });
      return { transfer: await retrieveInstantTransfer(input.organizationId, id, database), replayed: false };
    }

    let payment;
    try {
      payment = await createAccountPaymentInTransaction({
        organizationId: input.organizationId, actor: input.actor, idempotencyKey: `outbound-${input.idempotencyKey}`,
        accountId: account.id, direction: 'cash_out', counterparty: `${destination.kind}:${railLast4(destination.value)}`,
        description: input.transfer.description, amountMinor: input.transfer.amountMinor, currency: 'ARS', signals: input.signals,
      }, database);
    } catch (error) {
      if (error instanceof LedgerError) throw new InstantPaymentError(error.message, error.status, error.code);
      throw error;
    }
    if ('declined' in payment) return { declined: payment.declined, replayed: payment.replayed };
    await insertTransfer(database, {
      id, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, fingerprint, scheme: 'credit_push',
      direction: 'outbound', sourceAccountId: account.id, destinationAccountId: null, counterpartyKind: destination.kind,
      counterpartyValue: destination.value, holderName: input.transfer.holderName, taxIdLast4: input.transfer.taxIdLast4,
      amountMinor: input.transfer.amountMinor, description: input.transfer.description, externalReference: input.transfer.externalReference,
      status: payment.payment.status === 'review' ? 'pending' : 'settled', transactionId: payment.payment.id,
      qrPayload: null, expiresAt: null, actorId: input.actor.userId, createdAt,
    });
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.transfer_created',
      resourceType: 'instant_transfer', resourceId: id,
      payload: { scheme: 'credit_push', direction: 'outbound', status: payment.payment.status, amountMinor: input.transfer.amountMinor.toString() },
    });
    return { transfer: await retrieveInstantTransfer(input.organizationId, id, database), replayed: false };
  });
}

export async function returnInstantTransfer(input: {
  organizationId: string; actor: AuthUser; transferId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const transfer = await database.prepare(
      `SELECT id, status, transaction_id AS "transactionId" FROM instant_transfers WHERE organization_id = ? AND id = ? FOR UPDATE`,
    ).bind(input.organizationId, input.transferId).first<{ id: string; status: string; transactionId: string | null }>();
    if (!transfer) throw new InstantPaymentError('Transferencia instantánea no encontrada.', 404, 'instant_transfer_not_found');
    if (transfer.status !== 'settled' || !transfer.transactionId) {
      throw new InstantPaymentError('Sólo se puede devolver una transferencia liquidada.', 409, 'instant_transfer_not_returnable');
    }
    const result = await reverseTransactionInTransaction({
      organizationId: input.organizationId, actor: input.actor, transactionId: transfer.transactionId,
      idempotencyKey: input.idempotencyKey, auditAction: 'instant_transfer.returned',
    }, database);
    return {
      transfer: await retrieveInstantTransfer(input.organizationId, transfer.id, database),
      reversal: result.transaction, replayed: result.replayed,
    };
  });
}

export async function createDebitRequest(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; debit: NormalizedDebitRequestInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('debin', InstantPaymentError);
  const fingerprint = await sha256(JSON.stringify({ ...input.debit, amountMinor: input.debit.amountMinor.toString() }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${transferSelect} WHERE it.organization_id = ? AND it.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<TransferRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otra solicitud de débito.', 409, 'idempotency_mismatch');
      }
      return { debit: serializeTransfer(existing), replayed: true };
    }
    const collector = await loadAccount(database, input.organizationId, input.debit.collectorAccountId, true);
    assertArsAccount(collector);
    const payerInstrument = await findInstrumentByValue(database, input.organizationId, input.debit.payerDestination.value);
    if (!payerInstrument) {
      throw new InstantPaymentError('El sandbox sólo debita cuentas Cimbra del mismo tenant. No hay DEBIN contra CBU/CVU externos.', 422, 'external_debit_not_supported');
    }
    if (payerInstrument.accountId === collector.id) {
      throw new InstantPaymentError('El pagador y el cobrador deben ser cuentas distintas.', 400, 'same_account');
    }
    const payer = await loadAccount(database, input.organizationId, payerInstrument.accountId, true);
    assertArsAccount(payer);
    const referenceOwner = await database.prepare(
      'SELECT id FROM instant_transfers WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.debit.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new InstantPaymentError('La referencia externa ya pertenece a otra transferencia instantánea.', 409, 'external_reference_conflict');
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + input.debit.expiresInMinutes * 60_000).toISOString();
    await insertTransfer(database, {
      id, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, fingerprint, scheme: 'debit_pull',
      direction: 'internal', sourceAccountId: payer.id, destinationAccountId: collector.id,
      counterpartyKind: input.debit.payerDestination.kind, counterpartyValue: input.debit.payerDestination.value,
      holderName: payer.customerName, taxIdLast4: payer.taxIdLast4, amountMinor: input.debit.amountMinor,
      description: input.debit.description, externalReference: input.debit.externalReference, status: 'pending',
      transactionId: null, qrPayload: null, expiresAt, actorId: input.actor.userId, createdAt,
    });
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.debit_requested',
      resourceType: 'instant_transfer', resourceId: id,
      payload: { scheme: 'debit_pull', amountMinor: input.debit.amountMinor.toString(), expiresAt },
    });
    return { debit: await retrieveInstantTransfer(input.organizationId, id, database), replayed: false };
  });
}

export async function respondDebitRequest(input: {
  organizationId: string; actor: AuthUser; debitId: string; idempotencyKey: string;
  response: NormalizedDebitResponse; signals?: ProtectedRiskSignals;
}) {
  const fingerprint = await sha256(JSON.stringify(input.response));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant-debit-respond:${input.debitId}`).first();
    const debit = await database.prepare(
      `SELECT id, status, expires_at AS "expiresAt", source_account_id AS "sourceAccountId",
        destination_account_id AS "destinationAccountId", amount_minor::text AS "amountMinor", description,
        external_reference AS "externalReference"
       FROM instant_transfers WHERE organization_id = ? AND id = ? AND scheme = 'debit_pull' FOR UPDATE`,
    ).bind(input.organizationId, input.debitId).first<{
      id: string; status: string; expiresAt: string | null; sourceAccountId: string | null; destinationAccountId: string | null;
      amountMinor: string; description: string; externalReference: string;
    }>();
    if (!debit) throw new InstantPaymentError('Solicitud de débito no encontrada.', 404, 'debit_request_not_found');
    if (debit.status !== 'pending') {
      const current = await retrieveTransferRow(input.organizationId, debit.id, database);
      if (current && current.requestFingerprint === fingerprint) return { debit: serializeTransfer(current), replayed: true };
      throw new InstantPaymentError('La solicitud ya no está pendiente.', 409, 'debit_not_pending');
    }
    if (debit.expiresAt && debit.expiresAt <= new Date().toISOString()) {
      await database.prepare("UPDATE instant_transfers SET status = 'expired', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), debit.id).run();
      throw new InstantPaymentError('La solicitud de débito expiró.', 409, 'debit_expired');
    }
    const now = new Date().toISOString();
    if (input.response.decision === 'reject') {
      await database.prepare("UPDATE instant_transfers SET status = 'rejected', request_fingerprint = ?, updated_at = ? WHERE id = ?")
        .bind(fingerprint, now, debit.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.debit_rejected',
        resourceType: 'instant_transfer', resourceId: debit.id, payload: { decision: 'reject' },
      });
      return { debit: await retrieveInstantTransfer(input.organizationId, debit.id, database), replayed: false };
    }
    if (!debit.sourceAccountId || !debit.destinationAccountId) {
      throw new InstantPaymentError('La solicitud de débito no tiene cuentas internas.', 409, 'debit_incomplete');
    }
    const source = await loadAccount(database, input.organizationId, debit.sourceAccountId, true);
    const destination = await loadAccount(database, input.organizationId, debit.destinationAccountId, true);
    assertArsAccount(source); assertArsAccount(destination);
    const movement = await postInternalMovement(database, {
      organizationId: input.organizationId, actor: input.actor, operationKey: `instant-debit:${input.idempotencyKey}`,
      source, destination, amountMinor: BigInt(debit.amountMinor), description: debit.description,
      counterparty: `debit:${destination.accountReference}`, signals: input.signals,
    });
    if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
    await database.prepare(
      `UPDATE instant_transfers SET status = ?, transaction_id = ?, request_fingerprint = ?, updated_at = ? WHERE id = ?`,
    ).bind(movement.status, movement.transactionId, fingerprint, now, debit.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.debit_accepted',
      resourceType: 'instant_transfer', resourceId: debit.id,
      payload: { decision: 'accept', status: movement.status, transactionId: movement.transactionId },
    });
    return { debit: await retrieveInstantTransfer(input.organizationId, debit.id, database), replayed: false };
  });
}

export async function listPaymentQrs(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (q.created_at, q.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${qrSelect} WHERE q.organization_id = ? ${clause} ORDER BY q.created_at DESC, q.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<QrRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<QrRow>();
  return rows.results.map(serializeQr);
}

export async function createPaymentQr(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; qr: NormalizedPaymentQrInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('qr_interoperable', InstantPaymentError);
  const fingerprint = await sha256(JSON.stringify({
    accountId: input.qr.accountId, amountMinor: input.qr.amountMinor?.toString() ?? null,
    description: input.qr.description, expiresInMinutes: input.qr.expiresInMinutes, kind: input.qr.kind,
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-qr:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${qrSelect} WHERE q.organization_id = ? AND q.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<QrRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otro QR.', 409, 'idempotency_mismatch');
      }
      return { qr: serializeQr(existing), replayed: true };
    }
    const account = await loadAccount(database, input.organizationId, input.qr.accountId, true);
    assertArsAccount(account);
    if (input.qr.kind === 'static') {
      const cvu = await database.prepare(
        "SELECT id FROM rail_instruments WHERE organization_id = ? AND account_id = ? AND kind = 'cvu' AND status = 'active' LIMIT 1",
      ).bind(input.organizationId, account.id).first<{ id: string }>();
      if (!cvu) {
        throw new InstantPaymentError('El QR estático exige un CVU sandbox activo en la cuenta cobradora.', 422, 'cvu_required');
      }
      const activeStatic = await database.prepare(
        "SELECT id FROM payment_qrs WHERE organization_id = ? AND account_id = ? AND kind = 'static' AND status = 'active' LIMIT 1",
      ).bind(input.organizationId, account.id).first<{ id: string }>();
      if (activeStatic) {
        throw new InstantPaymentError('La cuenta ya tiene un QR estático activo. Cancelalo antes de emitir otro.', 409, 'static_qr_already_active');
      }
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = input.qr.kind === 'static' || input.qr.expiresInMinutes === null
      ? null
      : new Date(Date.now() + input.qr.expiresInMinutes * 60_000).toISOString();
    const payload = input.qr.kind === 'static' ? `cimbra:qr:static:v1:${id}` : `cimbra:qr:v1:${id}`;
    await database.prepare(`INSERT INTO payment_qrs
      (id, organization_id, idempotency_key, request_fingerprint, account_id, amount_minor, currency, description, payload,
       kind, status, expires_at, paid_transfer_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, 'active', ?, NULL, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, account.id,
        input.qr.amountMinor?.toString() ?? null, input.qr.description, payload, input.qr.kind, expiresAt,
        input.actor.userId, createdAt, createdAt).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.qr_created',
      resourceType: 'payment_qr', resourceId: id,
      payload: { accountId: account.id, kind: input.qr.kind, amountMinor: input.qr.amountMinor?.toString() ?? null, expiresAt },
    });
    const created = await database.prepare(`${qrSelect} WHERE q.organization_id = ? AND q.id = ? LIMIT 1`)
      .bind(input.organizationId, id).first<QrRow>();
    return { qr: serializeQr(created!), replayed: false };
  });
}

export async function payPaymentQr(input: {
  organizationId: string; actor: AuthUser; qrId: string; idempotencyKey: string;
  payment: NormalizedQrPayInput; signals?: ProtectedRiskSignals;
}) {
  await assertSandboxLedgerOrCertifiedRail('qr_interoperable', InstantPaymentError);
  const fingerprint = await sha256(JSON.stringify({
    qrId: input.qrId, ...input.payment, amountMinor: input.payment.amountMinor?.toString() ?? null, signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${transferSelect} WHERE it.organization_id = ? AND it.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<TransferRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otro pago QR.', 409, 'idempotency_mismatch');
      }
      return { transfer: serializeTransfer(existing), replayed: true };
    }
    const qr = await database.prepare(
      `SELECT id, account_id AS "accountId", amount_minor::text AS "amountMinor", description, payload, kind, status, expires_at AS "expiresAt"
       FROM payment_qrs WHERE organization_id = ? AND id = ? FOR UPDATE`,
    ).bind(input.organizationId, input.qrId).first<{
      id: string; accountId: string; amountMinor: string | null; description: string; payload: string;
      kind: 'dynamic' | 'static'; status: string; expiresAt: string | null;
    }>();
    if (!qr) throw new InstantPaymentError('QR no encontrado.', 404, 'payment_qr_not_found');
    if (qr.status !== 'active') throw new InstantPaymentError('El QR ya no está activo.', 409, 'qr_not_active');
    if (qr.kind === 'dynamic' && (!qr.expiresAt || qr.expiresAt <= new Date().toISOString())) {
      await database.prepare("UPDATE payment_qrs SET status = 'expired', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), qr.id).run();
      throw new InstantPaymentError('El QR expiró.', 409, 'qr_expired');
    }
    await expireStaleSaleOrders(database, input.organizationId, qr.id);
    const saleOrder = qr.kind === 'static'
      ? await database.prepare(
        `${saleOrderSelect} WHERE so.organization_id = ? AND so.payment_qr_id = ? AND so.status = 'pending' LIMIT 1 FOR UPDATE OF so`,
      ).bind(input.organizationId, qr.id).first<SaleOrderRow>()
      : null;
    const amountMinor = saleOrder
      ? BigInt(saleOrder.amountMinor)
      : qr.amountMinor ? BigInt(qr.amountMinor) : input.payment.amountMinor;
    if (!amountMinor) throw new InstantPaymentError('El QR de monto abierto requiere un importe.', 400, 'qr_amount_required');
    if (saleOrder && input.payment.amountMinor && input.payment.amountMinor !== amountMinor) {
      throw new InstantPaymentError('El importe no coincide con la orden de venta.', 422, 'sale_order_amount_mismatch');
    }
    if (!saleOrder && qr.amountMinor && input.payment.amountMinor && input.payment.amountMinor !== amountMinor) {
      throw new InstantPaymentError('El importe no coincide con el QR.', 422, 'qr_amount_mismatch');
    }
    if (input.payment.sourceAccountId === qr.accountId) {
      throw new InstantPaymentError('No se puede pagar un QR con la misma cuenta cobradora.', 400, 'same_account');
    }
    const referenceOwner = await database.prepare(
      'SELECT id FROM instant_transfers WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.payment.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new InstantPaymentError('La referencia externa ya pertenece a otra transferencia instantánea.', 409, 'external_reference_conflict');
    const source = await loadAccount(database, input.organizationId, input.payment.sourceAccountId, true);
    const destination = await loadAccount(database, input.organizationId, qr.accountId, true);
    assertArsAccount(source); assertArsAccount(destination);
    const movement = await postInternalMovement(database, {
      organizationId: input.organizationId, actor: input.actor, operationKey: `instant:${input.idempotencyKey}`,
      source, destination, amountMinor, description: saleOrder?.description ?? qr.description, counterparty: `qr:${destination.accountReference}`,
      signals: input.signals,
    });
    if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await insertTransfer(database, {
      id, organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, fingerprint, scheme: 'qr_collect',
      direction: 'internal', sourceAccountId: source.id, destinationAccountId: destination.id, counterpartyKind: 'alias',
      counterpartyValue: qr.payload.replace(/[^A-Z0-9]/gi, '').slice(0, 20).padEnd(6, 'X'), holderName: destination.customerName,
      taxIdLast4: destination.taxIdLast4, amountMinor, description: saleOrder?.description ?? qr.description, externalReference: input.payment.externalReference,
      status: movement.status, transactionId: movement.transactionId, qrPayload: qr.payload, expiresAt: null,
      actorId: input.actor.userId, createdAt,
    });
    if (movement.status === 'settled' && qr.kind === 'dynamic') {
      await database.prepare("UPDATE payment_qrs SET status = 'paid', paid_transfer_id = ?, updated_at = ? WHERE id = ?")
        .bind(id, createdAt, qr.id).run();
    }
    if (movement.status === 'settled' && saleOrder) {
      await database.prepare("UPDATE qr_sale_orders SET status = 'paid', paid_transfer_id = ?, updated_at = ? WHERE id = ?")
        .bind(id, createdAt, saleOrder.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.sale_order_paid',
        resourceType: 'qr_sale_order', resourceId: saleOrder.id,
        payload: { transferId: id, paymentQrId: qr.id, amountMinor: amountMinor.toString() },
      });
    }
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.qr_paid',
      resourceType: 'payment_qr', resourceId: qr.id,
      payload: { transferId: id, status: movement.status, amountMinor: amountMinor.toString(), kind: qr.kind },
    });
    return { transfer: await retrieveInstantTransfer(input.organizationId, id, database), replayed: false };
  });
}

export async function cancelPaymentQr(input: {
  organizationId: string; actor: AuthUser; qrId: string; idempotencyKey: string;
}) {
  await assertSandboxLedgerOrCertifiedRail('qr_interoperable', InstantPaymentError);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-qr-cancel:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`${qrSelect} WHERE q.organization_id = ? AND q.cancel_idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<QrRow>();
    if (replay) {
      if (replay.id !== input.qrId) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otro QR.', 409, 'idempotency_mismatch');
      }
      return { qr: serializeQr(replay), replayed: true };
    }
    const qr = await database.prepare(`${qrSelect} WHERE q.organization_id = ? AND q.id = ? LIMIT 1 FOR UPDATE OF q`)
      .bind(input.organizationId, input.qrId).first<QrRow>();
    if (!qr) throw new InstantPaymentError('QR no encontrado.', 404, 'payment_qr_not_found');
    if (qr.status !== 'active') {
      throw new InstantPaymentError('Sólo se puede cancelar un QR activo.', 409, 'qr_not_active');
    }
    const now = new Date().toISOString();
    await database.prepare(
      "UPDATE payment_qrs SET status = 'cancelled', cancel_idempotency_key = ?, updated_at = ? WHERE id = ?",
    ).bind(input.idempotencyKey, now, qr.id).run();
    await database.prepare(
      "UPDATE qr_sale_orders SET status = 'cancelled', updated_at = ? WHERE organization_id = ? AND payment_qr_id = ? AND status = 'pending'",
    ).bind(now, input.organizationId, qr.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.qr_cancelled',
      resourceType: 'payment_qr', resourceId: qr.id,
      payload: { kind: qr.kind, idempotencyKey: input.idempotencyKey },
    });
    return { qr: serializeQr({ ...qr, status: 'cancelled', updatedAt: now }), replayed: false };
  });
}

export async function listQrSaleOrders(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  await expireStaleSaleOrders(getDatabaseClient(), input.organizationId);
  const clause = input.cursor ? 'AND (so.created_at, so.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${saleOrderSelect} WHERE so.organization_id = ? ${clause} ORDER BY so.created_at DESC, so.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<SaleOrderRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<SaleOrderRow>();
  return rows.results.map(serializeSaleOrder);
}

export async function retrieveQrSaleOrder(organizationId: string, id: string) {
  await expireStaleSaleOrders(getDatabaseClient(), organizationId);
  const row = await getDatabaseClient().prepare(`${saleOrderSelect} WHERE so.organization_id = ? AND so.id = ? LIMIT 1`)
    .bind(organizationId, id).first<SaleOrderRow>();
  return row ? serializeSaleOrder(row) : null;
}

export async function createQrSaleOrder(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; order: NormalizedQrSaleOrderInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('qr_interoperable', InstantPaymentError);
  const fingerprint = await sha256(JSON.stringify({
    paymentQrId: input.order.paymentQrId, amountMinor: input.order.amountMinor.toString(),
    description: input.order.description, externalReference: input.order.externalReference,
    expiresInMinutes: input.order.expiresInMinutes,
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:qr-sale-order:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${saleOrderSelect} WHERE so.organization_id = ? AND so.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<SaleOrderRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otra orden de venta.', 409, 'idempotency_mismatch');
      }
      return { order: serializeSaleOrder(existing), replayed: true };
    }
    const qr = await database.prepare(`${qrSelect} WHERE q.organization_id = ? AND q.id = ? LIMIT 1 FOR UPDATE OF q`)
      .bind(input.organizationId, input.order.paymentQrId).first<QrRow>();
    if (!qr) throw new InstantPaymentError('QR no encontrado.', 404, 'payment_qr_not_found');
    if (qr.kind !== 'static') {
      throw new InstantPaymentError('La orden de venta sólo aplica a un QR estático activo.', 422, 'sale_order_requires_static_qr');
    }
    if (qr.status !== 'active') throw new InstantPaymentError('El QR ya no está activo.', 409, 'qr_not_active');
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:qr-sale-order-qr:${qr.id}`).first();
    await expireStaleSaleOrders(database, input.organizationId, qr.id);
    const referenceOwner = await database.prepare(
      'SELECT id FROM qr_sale_orders WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.order.externalReference).first<{ id: string }>();
    if (referenceOwner) {
      throw new InstantPaymentError('La referencia externa ya pertenece a otra orden de venta.', 409, 'external_reference_conflict');
    }
    const pending = await database.prepare(
      `${saleOrderSelect} WHERE so.organization_id = ? AND so.payment_qr_id = ? AND so.status = 'pending' LIMIT 1 FOR UPDATE OF so`,
    ).bind(input.organizationId, qr.id).first<SaleOrderRow>();
    const now = new Date().toISOString();
    if (pending) {
      await database.prepare("UPDATE qr_sale_orders SET status = 'superseded', updated_at = ? WHERE id = ?")
        .bind(now, pending.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.sale_order_superseded',
        resourceType: 'qr_sale_order', resourceId: pending.id,
        payload: { paymentQrId: qr.id, replacedByExternalReference: input.order.externalReference },
      });
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + input.order.expiresInMinutes * 60_000).toISOString();
    await database.prepare(`INSERT INTO qr_sale_orders
      (id, organization_id, idempotency_key, request_fingerprint, payment_qr_id, amount_minor, currency, description,
       external_reference, status, expires_at, paid_transfer_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, 'pending', ?, NULL, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, qr.id, input.order.amountMinor.toString(),
        input.order.description, input.order.externalReference, expiresAt, input.actor.userId, now, now).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.sale_order_created',
      resourceType: 'qr_sale_order', resourceId: id,
      payload: { paymentQrId: qr.id, amountMinor: input.order.amountMinor.toString(), expiresAt, supersededId: pending?.id ?? null },
    });
    const created = await database.prepare(`${saleOrderSelect} WHERE so.organization_id = ? AND so.id = ? LIMIT 1`)
      .bind(input.organizationId, id).first<SaleOrderRow>();
    return { order: serializeSaleOrder(created!), replayed: false };
  });
}

export async function cancelQrSaleOrder(input: {
  organizationId: string; actor: AuthUser; orderId: string; idempotencyKey: string;
}) {
  await assertSandboxLedgerOrCertifiedRail('qr_interoperable', InstantPaymentError);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:qr-sale-order-cancel:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`${saleOrderSelect} WHERE so.organization_id = ? AND so.cancel_idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<SaleOrderRow>();
    if (replay) {
      if (replay.id !== input.orderId) {
        throw new InstantPaymentError('La Idempotency-Key ya fue usada con otra orden de venta.', 409, 'idempotency_mismatch');
      }
      return { order: serializeSaleOrder(replay), replayed: true };
    }
    await expireStaleSaleOrders(database, input.organizationId);
    const order = await database.prepare(`${saleOrderSelect} WHERE so.organization_id = ? AND so.id = ? LIMIT 1 FOR UPDATE OF so`)
      .bind(input.organizationId, input.orderId).first<SaleOrderRow>();
    if (!order) throw new InstantPaymentError('Orden de venta no encontrada.', 404, 'sale_order_not_found');
    if (order.status !== 'pending') {
      throw new InstantPaymentError('Sólo se puede eliminar una orden de venta pendiente.', 409, 'sale_order_not_pending');
    }
    const now = new Date().toISOString();
    await database.prepare(
      "UPDATE qr_sale_orders SET status = 'cancelled', cancel_idempotency_key = ?, updated_at = ? WHERE id = ?",
    ).bind(input.idempotencyKey, now, order.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.sale_order_cancelled',
      resourceType: 'qr_sale_order', resourceId: order.id,
      payload: { paymentQrId: order.paymentQrId, idempotencyKey: input.idempotencyKey },
    });
    return { order: serializeSaleOrder({ ...order, status: 'cancelled', updatedAt: now }), replayed: false };
  });
}
