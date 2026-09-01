import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import { cuitLast4 } from '@/app/lib/platform/cuit';
import type {
  NormalizedEcheqAcceptInput, NormalizedEcheqDepositInput, NormalizedEcheqEndorseInput, NormalizedEcheqInput,
} from '@/app/lib/platform/echeqs-input';
import { argentinaToday } from '@/app/lib/platform/echeqs-input';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import { accountBalanceMinor, activeHoldsMinor, insertAudit, LedgerError, postJournal } from './ledger';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

export class EcheqError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'echeq_error') { super(message); }
}

type AccountRow = {
  id: string; ledgerAccountId: string; accountReference: string; customerName: string;
  taxIdLast4: string; currency: Currency; country: string; status: string;
};

type EcheqRow = {
  id: string; drawerAccountId: string; drawerAccountReference: string; drawerCustomerName: string;
  holderAccountId: string | null; holderAccountReference: string | null;
  amountMinor: string; currency: Currency; description: string; externalReference: string;
  payload: string; toOrder: number; paymentDate: string; expiresAt: string; status: string;
  beneficiaryName: string; beneficiaryTaxLast4: string; endorsementCount: number; rejectReason: string | null;
  transactionId: string | null; requestFingerprint: string;
  acceptFingerprint: string | null; endorseFingerprint: string | null; depositFingerprint: string | null;
  createdAt: string; updatedAt: string;
};

const echeqSelect = `SELECT e.id, e.drawer_account_id AS "drawerAccountId", drawer.account_reference AS "drawerAccountReference",
  drawer_customer.name AS "drawerCustomerName", e.holder_account_id AS "holderAccountId",
  holder.account_reference AS "holderAccountReference", e.amount_minor::text AS "amountMinor", e.currency,
  e.description, e.external_reference AS "externalReference", e.payload, e.to_order AS "toOrder",
  e.payment_date AS "paymentDate", e.expires_at AS "expiresAt", e.status, e.beneficiary_name AS "beneficiaryName",
  e.beneficiary_tax_last4 AS "beneficiaryTaxLast4", e.endorsement_count AS "endorsementCount",
  e.reject_reason AS "rejectReason", e.transaction_id AS "transactionId", e.request_fingerprint AS "requestFingerprint",
  e.accept_fingerprint AS "acceptFingerprint", e.endorse_fingerprint AS "endorseFingerprint",
  e.deposit_fingerprint AS "depositFingerprint", e.created_at AS "createdAt", e.updated_at AS "updatedAt"
  FROM echeqs e
  JOIN accounts drawer ON drawer.id = e.drawer_account_id
  JOIN customers drawer_customer ON drawer_customer.id = drawer.customer_id
  LEFT JOIN accounts holder ON holder.id = e.holder_account_id`;

function serializeEcheq(row: EcheqRow) {
  const {
    requestFingerprint: _request, acceptFingerprint: _accept, endorseFingerprint: _endorse, depositFingerprint: _deposit,
    toOrder, ...publicRow
  } = row;
  void _request; void _accept; void _endorse; void _deposit;
  return {
    ...publicRow,
    amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency),
    toOrder: toOrder === 1,
    rail: 'cimbra_sandbox' as const,
    status: effectiveStatus(row),
  };
}

function effectiveStatus(row: Pick<EcheqRow, 'status' | 'expiresAt'>) {
  if (['issued', 'accepted', 'endorsed'].includes(row.status) && row.expiresAt <= new Date().toISOString()) return 'expired';
  return row.status;
}

async function loadAccount(database: DatabaseClient, organizationId: string, accountId: string, lock = false) {
  return database.prepare(
    `SELECT a.id, a.ledger_account_id AS "ledgerAccountId", a.account_reference AS "accountReference",
      c.name AS "customerName", c.tax_id_last4 AS "taxIdLast4", a.currency, a.country, a.status
     FROM accounts a JOIN customers c ON c.id = a.customer_id
     WHERE a.organization_id = ? AND a.id = ? LIMIT 1 ${lock ? 'FOR UPDATE OF a' : ''}`,
  ).bind(organizationId, accountId).first<AccountRow>();
}

function assertArgentineAccount(account: AccountRow | null, label: string): asserts account is AccountRow {
  if (!account) throw new EcheqError(`${label} no encontrada.`, 404, 'account_not_found');
  if (account.status !== 'active') throw new EcheqError(`La cuenta ${label.toLowerCase()} no está activa.`, 409, 'account_inactive');
  if (account.currency !== 'ARS') throw new EcheqError('El ECHEQ sandbox opera sólo en ARS.', 409, 'currency_mismatch');
  if (account.country !== 'AR') throw new EcheqError('El ECHEQ sandbox sólo se emite o deposita en cuentas argentinas.', 409, 'country_mismatch');
}

async function retrieveEcheqRow(organizationId: string, id: string, database: DatabaseClient) {
  return database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1`)
    .bind(organizationId, id).first<EcheqRow>();
}

async function expireIfNeeded(database: DatabaseClient, row: EcheqRow) {
  const status = effectiveStatus(row);
  if (status !== 'expired' || row.status === 'expired') return { ...row, status };
  const now = new Date().toISOString();
  await database.prepare("UPDATE echeqs SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('issued', 'accepted', 'endorsed')")
    .bind(now, row.id).run();
  return { ...row, status: 'expired', updatedAt: now };
}

async function assertCurrentBeneficiary(database: DatabaseClient, organizationId: string, echeqId: string, taxId: string) {
  const hash = await sha256(taxId);
  const row = await database.prepare(
    'SELECT beneficiary_tax_hash AS "beneficiaryTaxHash" FROM echeqs WHERE organization_id = ? AND id = ? LIMIT 1',
  ).bind(organizationId, echeqId).first<{ beneficiaryTaxHash: string }>();
  if (!row || row.beneficiaryTaxHash !== hash) {
    throw new EcheqError('El CUIT no coincide con el tenedor actual del ECHEQ.', 422, 'holder_mismatch');
  }
  return hash;
}

function assertHolderTax(account: AccountRow, taxId: string) {
  if (account.taxIdLast4 !== cuitLast4(taxId)) {
    throw new EcheqError('El CUIT no coincide con el titular de la cuenta.', 422, 'tax_mismatch');
  }
}

async function postDeposit(database: DatabaseClient, input: {
  organizationId: string; actor: AuthUser; operationKey: string; source: AccountRow; destination: AccountRow;
  amountMinor: bigint; description: string; counterparty: string; signals?: ProtectedRiskSignals;
}) {
  const [current, held] = await Promise.all([
    accountBalanceMinor(input.source.ledgerAccountId, database), activeHoldsMinor(input.source.ledgerAccountId, database),
  ]);
  if (input.amountMinor > current - held) return { rejected: true as const, reason: 'insufficient_funds' };
  let assessment;
  try {
    assessment = await assessRisk({
      organizationId: input.organizationId, idempotencyKey: input.operationKey, operationType: 'transfer',
      amountMinor: input.amountMinor, currency: 'ARS', counterparty: input.counterparty, signals: input.signals,
    }, database);
  } catch (error) {
    if (error instanceof RiskError) throw new EcheqError(error.message, error.status, error.code);
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
     reversal_of, created_at, updated_at) VALUES (?, ?, ?, 'echeq', ?, ?, ?, 'ARS', ?, ?, NULL, ?, ?)`)
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
      organizationId: input.organizationId, transactionId, idempotencyKey: input.operationKey, kind: 'echeq',
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
  return { transactionId, status: status === 'review' ? 'pending' : 'deposited', replayed: false as const };
}

export async function listEcheqs(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (e.created_at, e.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${echeqSelect} WHERE e.organization_id = ? ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<EcheqRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<EcheqRow>();
  return rows.results.map(serializeEcheq);
}

export async function retrieveEcheq(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await retrieveEcheqRow(organizationId, id, database);
  return row ? serializeEcheq(row) : null;
}

export async function issueEcheq(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; echeq: NormalizedEcheqInput;
}) {
  const fingerprint = await sha256(JSON.stringify({
    ...input.echeq, amountMinor: input.echeq.amountMinor.toString(),
  }));
  const taxHash = await sha256(input.echeq.beneficiaryTaxId);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<EcheqRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new EcheqError('La Idempotency-Key ya fue usada con otro ECHEQ.', 409, 'idempotency_mismatch');
      }
      return { echeq: serializeEcheq(existing), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-ref:${input.echeq.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM echeqs WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.echeq.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new EcheqError('La referencia externa ya pertenece a otro ECHEQ.', 409, 'external_reference_conflict');
    const drawer = await loadAccount(database, input.organizationId, input.echeq.drawerAccountId, true);
    assertArgentineAccount(drawer, 'Cuenta libradora');
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = `${input.echeq.expiresOn}T23:59:59.000-03:00`;
    const payload = `cimbra:echeq:v1:${id}`;
    await database.prepare(`INSERT INTO echeqs
      (id, organization_id, idempotency_key, request_fingerprint, drawer_account_id, holder_account_id, amount_minor,
       currency, description, external_reference, payload, to_order, payment_date, expires_at, status, beneficiary_name,
       beneficiary_tax_hash, beneficiary_tax_last4, endorsement_count, reject_reason, transaction_id, created_by,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, 'ARS', ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, 0, NULL, NULL, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, drawer.id, input.echeq.amountMinor.toString(),
        input.echeq.description, input.echeq.externalReference, payload, input.echeq.toOrder ? 1 : 0,
        input.echeq.paymentDate, expiresAt, input.echeq.beneficiaryName, taxHash, cuitLast4(input.echeq.beneficiaryTaxId),
        input.actor.userId, createdAt, createdAt).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.issued',
      resourceType: 'echeq', resourceId: id,
      payload: { drawerAccountId: drawer.id, amountMinor: input.echeq.amountMinor.toString(), paymentDate: input.echeq.paymentDate },
    });
    return { echeq: serializeEcheq((await retrieveEcheqRow(input.organizationId, id, database))!), replayed: false };
  });
}

export async function acceptEcheq(input: {
  organizationId: string; actor: AuthUser; echeqId: string; idempotencyKey: string; accept: NormalizedEcheqAcceptInput;
}) {
  const fingerprint = await sha256(JSON.stringify(input.accept));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-accept:${input.echeqId}`).first();
    const row = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1 FOR UPDATE OF e`)
      .bind(input.organizationId, input.echeqId).first<EcheqRow>();
    if (!row) throw new EcheqError('ECHEQ no encontrado.', 404, 'echeq_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.acceptFingerprint === fingerprint && current.status === 'accepted') {
      return { echeq: serializeEcheq(current), replayed: true };
    }
    if (!['issued', 'endorsed'].includes(current.status)) {
      throw new EcheqError('El ECHEQ no está pendiente de aceptación.', 409, 'echeq_not_acceptable');
    }
    await assertCurrentBeneficiary(database, input.organizationId, current.id, input.accept.taxId);
    const holder = await loadAccount(database, input.organizationId, input.accept.accountId, true);
    assertArgentineAccount(holder, 'Cuenta tenedora');
    if (holder.id === current.drawerAccountId) {
      throw new EcheqError('El tenedor debe ser distinto al librador.', 422, 'same_account');
    }
    assertHolderTax(holder, input.accept.taxId);
    const now = new Date().toISOString();
    await database.prepare(`UPDATE echeqs SET status = 'accepted', holder_account_id = ?, accept_idempotency_key = ?,
      accept_fingerprint = ?, updated_at = ? WHERE id = ?`)
      .bind(holder.id, input.idempotencyKey, fingerprint, now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.accepted',
      resourceType: 'echeq', resourceId: current.id, payload: { holderAccountId: holder.id },
    });
    return { echeq: serializeEcheq((await retrieveEcheqRow(input.organizationId, current.id, database))!), replayed: false };
  });
}

export async function endorseEcheq(input: {
  organizationId: string; actor: AuthUser; echeqId: string; idempotencyKey: string; endorse: NormalizedEcheqEndorseInput;
}) {
  const fingerprint = await sha256(JSON.stringify(input.endorse));
  const taxHash = await sha256(input.endorse.beneficiaryTaxId);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-endorse:${input.echeqId}`).first();
    const row = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1 FOR UPDATE OF e`)
      .bind(input.organizationId, input.echeqId).first<EcheqRow>();
    if (!row) throw new EcheqError('ECHEQ no encontrado.', 404, 'echeq_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.endorseFingerprint === fingerprint && current.status === 'endorsed') {
      return { echeq: serializeEcheq(current), replayed: true };
    }
    if (current.status !== 'accepted') {
      throw new EcheqError('Sólo se puede endosar un ECHEQ aceptado.', 409, 'echeq_not_endorsable');
    }
    if (current.toOrder !== 1) {
      throw new EcheqError('El ECHEQ no es a la orden.', 422, 'echeq_not_to_order');
    }
    const now = new Date().toISOString();
    const endorsementId = crypto.randomUUID();
    await database.prepare(`INSERT INTO echeq_endorsements
      (id, organization_id, echeq_id, idempotency_key, request_fingerprint, beneficiary_name, beneficiary_tax_hash,
       beneficiary_tax_last4, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(endorsementId, input.organizationId, current.id, input.idempotencyKey, fingerprint, input.endorse.beneficiaryName,
        taxHash, cuitLast4(input.endorse.beneficiaryTaxId), input.actor.userId, now).run();
    await database.prepare(`UPDATE echeqs SET status = 'endorsed', holder_account_id = NULL, beneficiary_name = ?,
      beneficiary_tax_hash = ?, beneficiary_tax_last4 = ?, endorsement_count = endorsement_count + 1,
      endorse_idempotency_key = ?, endorse_fingerprint = ?, accept_idempotency_key = NULL, accept_fingerprint = NULL,
      updated_at = ? WHERE id = ?`)
      .bind(input.endorse.beneficiaryName, taxHash, cuitLast4(input.endorse.beneficiaryTaxId),
        input.idempotencyKey, fingerprint, now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.endorsed',
      resourceType: 'echeq', resourceId: current.id,
      payload: { endorsementId, beneficiaryTaxLast4: cuitLast4(input.endorse.beneficiaryTaxId) },
    });
    return { echeq: serializeEcheq((await retrieveEcheqRow(input.organizationId, current.id, database))!), replayed: false };
  });
}

export async function cancelEcheq(input: {
  organizationId: string; actor: AuthUser; echeqId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-cancel:${input.echeqId}`).first();
    const row = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1 FOR UPDATE OF e`)
      .bind(input.organizationId, input.echeqId).first<EcheqRow>();
    if (!row) throw new EcheqError('ECHEQ no encontrado.', 404, 'echeq_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.status === 'cancelled') return { echeq: serializeEcheq(current), replayed: true };
    if (current.status !== 'issued') {
      throw new EcheqError('Sólo se puede anular un ECHEQ no aceptado.', 409, 'echeq_not_cancellable');
    }
    const now = new Date().toISOString();
    await database.prepare("UPDATE echeqs SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.cancelled',
      resourceType: 'echeq', resourceId: current.id, payload: { idempotencyKey: input.idempotencyKey },
    });
    return { echeq: serializeEcheq({ ...current, status: 'cancelled', updatedAt: now }), replayed: false };
  });
}

export async function returnEcheq(input: {
  organizationId: string; actor: AuthUser; echeqId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-return:${input.echeqId}`).first();
    const row = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1 FOR UPDATE OF e`)
      .bind(input.organizationId, input.echeqId).first<EcheqRow>();
    if (!row) throw new EcheqError('ECHEQ no encontrado.', 404, 'echeq_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.status === 'returned') return { echeq: serializeEcheq(current), replayed: true };
    if (!['accepted', 'endorsed'].includes(current.status)) {
      throw new EcheqError('Sólo se puede devolver un ECHEQ aceptado o endosado, antes del depósito.', 409, 'echeq_not_returnable');
    }
    const now = new Date().toISOString();
    await database.prepare("UPDATE echeqs SET status = 'returned', holder_account_id = NULL, updated_at = ? WHERE id = ?")
      .bind(now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.returned',
      resourceType: 'echeq', resourceId: current.id, payload: { idempotencyKey: input.idempotencyKey },
    });
    return { echeq: serializeEcheq({ ...current, status: 'returned', holderAccountId: null, holderAccountReference: null, updatedAt: now }), replayed: false };
  });
}

export async function depositEcheq(input: {
  organizationId: string; actor: AuthUser; echeqId: string; idempotencyKey: string;
  deposit: NormalizedEcheqDepositInput; signals?: ProtectedRiskSignals;
}) {
  const fingerprint = await sha256(JSON.stringify({
    accountId: input.deposit.accountId, taxId: input.deposit.taxId, signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:echeq-deposit:${input.echeqId}`).first();
    const row = await database.prepare(`${echeqSelect} WHERE e.organization_id = ? AND e.id = ? LIMIT 1 FOR UPDATE OF e`)
      .bind(input.organizationId, input.echeqId).first<EcheqRow>();
    if (!row) throw new EcheqError('ECHEQ no encontrado.', 404, 'echeq_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.depositFingerprint === fingerprint && (current.status === 'deposited' || current.status === 'pending' || current.status === 'rejected')) {
      return { echeq: serializeEcheq(current), replayed: true };
    }
    if (current.status === 'deposited' || current.status === 'pending') {
      throw new EcheqError('El ECHEQ ya fue depositado.', 409, 'echeq_already_deposited');
    }
    if (current.status === 'rejected') {
      throw new EcheqError('El ECHEQ ya fue rechazado por falta de fondos.', 409, 'echeq_already_rejected');
    }
    if (current.status !== 'accepted') {
      throw new EcheqError('El ECHEQ debe estar aceptado para depositarse en una cuenta Cimbra.', 409, 'echeq_not_depositable');
    }
    if (current.paymentDate > argentinaToday()) {
      throw new EcheqError('El ECHEQ todavía no está en fecha de pago.', 422, 'echeq_not_due');
    }
    await assertCurrentBeneficiary(database, input.organizationId, current.id, input.deposit.taxId);
    const holder = await loadAccount(database, input.organizationId, input.deposit.accountId, true);
    assertArgentineAccount(holder, 'Cuenta depositaria');
    if (current.holderAccountId && current.holderAccountId !== holder.id) {
      throw new EcheqError('La cuenta depositaria debe ser la del tenedor que aceptó el ECHEQ.', 422, 'holder_account_mismatch');
    }
    if (holder.id === current.drawerAccountId) {
      throw new EcheqError('No se puede depositar el ECHEQ en la cuenta libradora.', 422, 'same_account');
    }
    assertHolderTax(holder, input.deposit.taxId);
    const drawer = await loadAccount(database, input.organizationId, current.drawerAccountId, true);
    assertArgentineAccount(drawer, 'Cuenta libradora');
    const now = new Date().toISOString();
    const movement = await postDeposit(database, {
      organizationId: input.organizationId, actor: input.actor, operationKey: `echeq-deposit:${input.idempotencyKey}`,
      source: drawer, destination: holder, amountMinor: BigInt(current.amountMinor), description: current.description,
      counterparty: `echeq:${current.payload}`, signals: input.signals,
    });
    if ('rejected' in movement && movement.rejected) {
      await database.prepare(`UPDATE echeqs SET status = 'rejected', reject_reason = ?, deposit_idempotency_key = ?,
        deposit_fingerprint = ?, updated_at = ? WHERE id = ?`)
        .bind(movement.reason, input.idempotencyKey, fingerprint, now, current.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'echeq.rejected',
        resourceType: 'echeq', resourceId: current.id, payload: { reason: movement.reason },
      });
      return { echeq: serializeEcheq((await retrieveEcheqRow(input.organizationId, current.id, database))!), replayed: false };
    }
    if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
    await database.prepare(`UPDATE echeqs SET status = ?, holder_account_id = ?, transaction_id = ?,
      deposit_idempotency_key = ?, deposit_fingerprint = ?, updated_at = ? WHERE id = ?`)
      .bind(movement.status, holder.id, movement.transactionId, input.idempotencyKey, fingerprint, now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId,
      action: movement.status === 'pending' ? 'echeq.deposited' : 'echeq.deposited',
      resourceType: 'echeq', resourceId: current.id,
      payload: { status: movement.status, transactionId: movement.transactionId },
    });
    return { echeq: serializeEcheq((await retrieveEcheqRow(input.organizationId, current.id, database))!), replayed: false };
  });
}
