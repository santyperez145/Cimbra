import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import type { CollectionMethod, NormalizedPaymentLinkInput, NormalizedPaymentLinkPayInput } from '@/app/lib/platform/collections-input';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import {
  accountBalanceMinor, activeHoldsMinor, createAccountPaymentInTransaction, insertAudit, LedgerError, postJournal,
  reverseTransactionInTransaction,
} from './ledger';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

export class CollectionError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'collection_error') { super(message); }
}

type AccountRow = {
  id: string; ledgerAccountId: string; accountReference: string; customerName: string;
  currency: Currency; country: string; status: string;
};

type LinkRow = {
  id: string; accountId: string; accountReference: string; customerName: string;
  amountMinor: string; currency: Currency; description: string; externalReference: string;
  allowedMethods: string; payload: string; status: string; expiresAt: string;
  paidMethod: CollectionMethod | null; payerAccountId: string | null; payerAccountReference: string | null;
  transactionId: string | null; reversalTransactionId: string | null;
  requestFingerprint: string; payFingerprint: string | null; createdAt: string; updatedAt: string;
};

const linkSelect = `SELECT pl.id, pl.account_id AS "accountId", a.account_reference AS "accountReference",
  c.name AS "customerName", pl.amount_minor::text AS "amountMinor", pl.currency, pl.description,
  pl.external_reference AS "externalReference", pl.allowed_methods AS "allowedMethods", pl.payload, pl.status,
  pl.expires_at AS "expiresAt", pl.paid_method AS "paidMethod", pl.payer_account_id AS "payerAccountId",
  payer.account_reference AS "payerAccountReference", pl.transaction_id AS "transactionId",
  pl.reversal_transaction_id AS "reversalTransactionId", pl.request_fingerprint AS "requestFingerprint",
  pl.pay_fingerprint AS "payFingerprint", pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
  FROM payment_links pl JOIN accounts a ON a.id = pl.account_id JOIN customers c ON c.id = a.customer_id
  LEFT JOIN accounts payer ON payer.id = pl.payer_account_id`;

function parseMethods(value: string): CollectionMethod[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CollectionMethod => item === 'internal' || item === 'sandbox_inbound') : [];
  } catch {
    return [];
  }
}

function effectiveStatus(row: Pick<LinkRow, 'status' | 'expiresAt'>) {
  return row.status === 'open' && row.expiresAt <= new Date().toISOString() ? 'expired' : row.status;
}

function serializeLink(row: LinkRow) {
  const { requestFingerprint: _fingerprint, payFingerprint: _pay, ...publicRow } = row;
  void _fingerprint; void _pay;
  return {
    ...publicRow,
    amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency),
    allowedMethods: parseMethods(row.allowedMethods),
    status: effectiveStatus(row),
  };
}

async function loadAccount(database: DatabaseClient, organizationId: string, accountId: string, lock = false) {
  return database.prepare(
    `SELECT a.id, a.ledger_account_id AS "ledgerAccountId", a.account_reference AS "accountReference",
      c.name AS "customerName", a.currency, a.country, a.status
     FROM accounts a JOIN customers c ON c.id = a.customer_id
     WHERE a.organization_id = ? AND a.id = ? LIMIT 1 ${lock ? 'FOR UPDATE OF a' : ''}`,
  ).bind(organizationId, accountId).first<AccountRow>();
}

function assertCollector(account: AccountRow | null): asserts account is AccountRow {
  if (!account) throw new CollectionError('Cuenta no encontrada.', 404, 'account_not_found');
  if (account.status !== 'active') throw new CollectionError('La cuenta no está activa.', 409, 'account_inactive');
  if (account.currency !== 'ARS') throw new CollectionError('Las cobranzas sandbox de Argentina operan sólo en ARS.', 409, 'currency_mismatch');
  if (account.country !== 'AR') throw new CollectionError('El link de cobro sandbox sólo se emite para cuentas argentinas.', 409, 'country_mismatch');
}

async function retrieveLinkRow(organizationId: string, id: string, database: DatabaseClient) {
  return database.prepare(`${linkSelect} WHERE pl.organization_id = ? AND pl.id = ? LIMIT 1`)
    .bind(organizationId, id).first<LinkRow>();
}

async function expireIfNeeded(database: DatabaseClient, row: LinkRow) {
  if (row.status !== 'open' || row.expiresAt > new Date().toISOString()) return row;
  const now = new Date().toISOString();
  await database.prepare("UPDATE payment_links SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'")
    .bind(now, row.id).run();
  return { ...row, status: 'expired', updatedAt: now };
}

async function postInternalCollection(database: DatabaseClient, input: {
  organizationId: string; actor: AuthUser; operationKey: string; source: AccountRow; destination: AccountRow;
  amountMinor: bigint; description: string; counterparty: string; signals?: ProtectedRiskSignals;
}) {
  const [current, held] = await Promise.all([
    accountBalanceMinor(input.source.ledgerAccountId, database), activeHoldsMinor(input.source.ledgerAccountId, database),
  ]);
  if (input.amountMinor > current - held) {
    throw new CollectionError('Saldo disponible insuficiente en la cuenta pagadora.', 422, 'insufficient_funds');
  }
  let assessment;
  try {
    assessment = await assessRisk({
      organizationId: input.organizationId, idempotencyKey: input.operationKey, operationType: 'transfer',
      amountMinor: input.amountMinor, currency: 'ARS', counterparty: input.counterparty, signals: input.signals,
    }, database);
  } catch (error) {
    if (error instanceof RiskError) throw new CollectionError(error.message, error.status, error.code);
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
     reversal_of, created_at, updated_at) VALUES (?, ?, ?, 'collection', ?, ?, ?, 'ARS', ?, ?, NULL, ?, ?)`)
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
      organizationId: input.organizationId, transactionId, idempotencyKey: input.operationKey, kind: 'collection',
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
  return { transactionId, status: status === 'review' ? 'pending' : 'paid', replayed: false as const };
}

export async function listPaymentLinks(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (pl.created_at, pl.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${linkSelect} WHERE pl.organization_id = ? ${clause} ORDER BY pl.created_at DESC, pl.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<LinkRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<LinkRow>();
  return rows.results.map(serializeLink);
}

export async function retrievePaymentLink(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await retrieveLinkRow(organizationId, id, database);
  return row ? serializeLink(row) : null;
}

export async function createPaymentLink(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; link: NormalizedPaymentLinkInput;
}) {
  const fingerprint = await sha256(JSON.stringify({
    ...input.link, amountMinor: input.link.amountMinor.toString(),
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${linkSelect} WHERE pl.organization_id = ? AND pl.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<LinkRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new CollectionError('La Idempotency-Key ya fue usada con otro link de cobro.', 409, 'idempotency_mismatch');
      }
      return { link: serializeLink(existing), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-ref:${input.link.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM payment_links WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.link.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new CollectionError('La referencia externa ya pertenece a otro link de cobro.', 409, 'external_reference_conflict');
    const account = await loadAccount(database, input.organizationId, input.link.accountId, true);
    assertCollector(account);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + input.link.expiresInMinutes * 60_000).toISOString();
    const payload = `cimbra:link:v1:${id}`;
    await database.prepare(`INSERT INTO payment_links
      (id, organization_id, idempotency_key, request_fingerprint, account_id, amount_minor, currency, description,
       external_reference, allowed_methods, payload, status, expires_at, paid_method, payer_account_id, transaction_id,
       reversal_transaction_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?, 'open', ?, NULL, NULL, NULL, NULL, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, account.id, input.link.amountMinor.toString(),
        input.link.description, input.link.externalReference, JSON.stringify(input.link.methods), payload, expiresAt,
        input.actor.userId, createdAt, createdAt).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_created',
      resourceType: 'payment_link', resourceId: id,
      payload: { accountId: account.id, amountMinor: input.link.amountMinor.toString(), methods: input.link.methods, expiresAt },
    });
    return { link: serializeLink((await retrieveLinkRow(input.organizationId, id, database))!), replayed: false };
  });
}

export async function cancelPaymentLink(input: {
  organizationId: string; actor: AuthUser; linkId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-cancel:${input.linkId}`).first();
    const row = await database.prepare(`${linkSelect} WHERE pl.organization_id = ? AND pl.id = ? LIMIT 1 FOR UPDATE OF pl`)
      .bind(input.organizationId, input.linkId).first<LinkRow>();
    if (!row) throw new CollectionError('Link de cobro no encontrado.', 404, 'payment_link_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.status === 'cancelled') return { link: serializeLink(current), replayed: true };
    if (current.status !== 'open') {
      throw new CollectionError('Sólo se puede cancelar un link abierto.', 409, 'payment_link_not_open');
    }
    const now = new Date().toISOString();
    await database.prepare("UPDATE payment_links SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_cancelled',
      resourceType: 'payment_link', resourceId: current.id, payload: { idempotencyKey: input.idempotencyKey },
    });
    return { link: serializeLink({ ...current, status: 'cancelled', updatedAt: now }), replayed: false };
  });
}

export async function payPaymentLink(input: {
  organizationId: string; actor: AuthUser; linkId: string; idempotencyKey: string;
  payment: NormalizedPaymentLinkPayInput; signals?: ProtectedRiskSignals;
}) {
  const fingerprint = await sha256(JSON.stringify({
    ...input.payment, signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-pay:${input.linkId}`).first();
    const row = await database.prepare(`${linkSelect} WHERE pl.organization_id = ? AND pl.id = ? LIMIT 1 FOR UPDATE OF pl`)
      .bind(input.organizationId, input.linkId).first<LinkRow>();
    if (!row) throw new CollectionError('Link de cobro no encontrado.', 404, 'payment_link_not_found');
    const current = await expireIfNeeded(database, row);
    if (current.payFingerprint === fingerprint && (current.status === 'paid' || current.status === 'pending')) {
      return { link: serializeLink(current), replayed: true };
    }
    if (current.status === 'paid' || current.status === 'pending') {
      throw new CollectionError('El link ya fue cobrado.', 409, 'payment_link_already_paid');
    }
    if (current.status !== 'open') {
      throw new CollectionError('El link no está disponible para cobro.', 409, 'payment_link_not_open');
    }
    const allowed = parseMethods(current.allowedMethods);
    if (!allowed.includes(input.payment.method)) {
      throw new CollectionError('El medio de cobro no está habilitado en este link.', 422, 'method_not_allowed');
    }
    const merchant = await loadAccount(database, input.organizationId, current.accountId, true);
    assertCollector(merchant);
    const now = new Date().toISOString();
    if (input.payment.method === 'internal') {
      if (!input.payment.payerAccountId) throw new CollectionError('El cobro interno exige cuenta pagadora.', 400, 'payer_required');
      if (input.payment.payerAccountId === merchant.id) {
        throw new CollectionError('La cuenta pagadora debe ser distinta a la del comercio.', 422, 'same_account');
      }
      const payer = await loadAccount(database, input.organizationId, input.payment.payerAccountId, true);
      assertCollector(payer);
      const movement = await postInternalCollection(database, {
        organizationId: input.organizationId, actor: input.actor, operationKey: `collection-pay:${input.idempotencyKey}`,
        source: payer, destination: merchant, amountMinor: BigInt(current.amountMinor), description: current.description,
        counterparty: `link:${current.payload}`, signals: input.signals,
      });
      if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
      await database.prepare(`UPDATE payment_links SET status = ?, paid_method = 'internal', payer_account_id = ?,
        transaction_id = ?, pay_idempotency_key = ?, pay_fingerprint = ?, updated_at = ? WHERE id = ?`)
        .bind(movement.status, payer.id, movement.transactionId, input.idempotencyKey, fingerprint, now, current.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_paid',
        resourceType: 'payment_link', resourceId: current.id,
        payload: { method: 'internal', status: movement.status, transactionId: movement.transactionId },
      });
      return { link: serializeLink((await retrieveLinkRow(input.organizationId, current.id, database))!), replayed: false };
    }
    let payment;
    try {
      payment = await createAccountPaymentInTransaction({
        organizationId: input.organizationId, actor: input.actor, idempotencyKey: `collection-in-${input.idempotencyKey}`,
        accountId: merchant.id, direction: 'cash_in', counterparty: `link:${current.payload}`,
        description: current.description, amountMinor: BigInt(current.amountMinor), currency: 'ARS', signals: input.signals,
      }, database);
    } catch (error) {
      if (error instanceof LedgerError) throw new CollectionError(error.message, error.status, error.code);
      throw error;
    }
    if ('declined' in payment) return { declined: payment.declined, replayed: payment.replayed };
    const status = payment.payment.status === 'review' ? 'pending' : 'paid';
    await database.prepare(`UPDATE payment_links SET status = ?, paid_method = 'sandbox_inbound',
      transaction_id = ?, pay_idempotency_key = ?, pay_fingerprint = ?, updated_at = ? WHERE id = ?`)
      .bind(status, payment.payment.id, input.idempotencyKey, fingerprint, now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_paid',
      resourceType: 'payment_link', resourceId: current.id,
      payload: { method: 'sandbox_inbound', status, transactionId: payment.payment.id },
    });
    return { link: serializeLink((await retrieveLinkRow(input.organizationId, current.id, database))!), replayed: false };
  });
}

export async function refundPaymentLink(input: {
  organizationId: string; actor: AuthUser; linkId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-refund:${input.linkId}`).first();
    const row = await database.prepare(
      `SELECT id, status, transaction_id AS "transactionId" FROM payment_links WHERE organization_id = ? AND id = ? FOR UPDATE`,
    ).bind(input.organizationId, input.linkId).first<{ id: string; status: string; transactionId: string | null }>();
    if (!row) throw new CollectionError('Link de cobro no encontrado.', 404, 'payment_link_not_found');
    if (row.status !== 'paid' || !row.transactionId) {
      if (row.status === 'refunded') {
        const existing = await database.prepare(
          'SELECT id FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1',
        ).bind(input.organizationId, `reversal:${input.idempotencyKey}`).first<{ id: string }>();
        if (existing) {
          return { link: serializeLink((await retrieveLinkRow(input.organizationId, row.id, database))!), replayed: true };
        }
        throw new CollectionError('El cobro ya fue devuelto.', 409, 'payment_link_already_refunded');
      }
      throw new CollectionError('Sólo se puede devolver un cobro liquidado.', 409, 'payment_link_not_paid');
    }
    let reversal;
    try {
      reversal = await reverseTransactionInTransaction({
        organizationId: input.organizationId, actor: input.actor, transactionId: row.transactionId,
        idempotencyKey: input.idempotencyKey, auditAction: 'collection.refunded',
      }, database);
    } catch (error) {
      if (error instanceof LedgerError) throw new CollectionError(error.message, error.status, error.code);
      throw error;
    }
    return {
      link: serializeLink((await retrieveLinkRow(input.organizationId, row.id, database))!),
      reversal: reversal.transaction, replayed: reversal.replayed,
    };
  });
}
