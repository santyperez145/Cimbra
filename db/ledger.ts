import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, majorToMinor, minorToMajorNumber } from '@/app/lib/ledger/money';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { DatabaseClient, getDatabaseClient } from './client';
import { enqueueWebhookEvent } from './platform';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

type Direction = 'debit' | 'credit';

type Posting = {
  accountId: string;
  direction: Direction;
  amountMinor: bigint;
};

type StoredTransaction = {
  id: string;
  counterparty: string;
  description: string;
  amountMinor: string;
  currency: Currency;
  status: string;
  riskScore: number;
  reversalOf: string | null;
  createdAt: string;
};

export class LedgerError extends Error {
  constructor(message: string, readonly status: number = 400, readonly code = 'ledger_error') {
    super(message);
  }
}

export async function insertAudit(database: DatabaseClient, input: {
  organizationId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payload?: Record<string, unknown>;
}) {
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType,
    input.resourceId, JSON.stringify(input.payload ?? {}), new Date().toISOString(),
  ).run();
  await enqueueWebhookEvent(database, {
    organizationId: input.organizationId,
    eventType: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    data: input.payload,
  });
}

export async function getOrCreateCoreAccounts(
  organizationId: string,
  currency: Currency,
  database: DatabaseClient = getDatabaseClient(),
) {
  const now = new Date().toISOString();
  const definitions = [
    { purpose: 'settlement', name: `Fondos de liquidación ${currency}`, accountClass: 'asset', normalBalance: 'debit' },
    { purpose: 'customer_funds', name: `Fondos de clientes ${currency}`, accountClass: 'liability', normalBalance: 'credit' },
  ] as const;
  for (const account of definitions) {
    await database.prepare(
      `INSERT INTO financial_accounts
        (id, organization_id, purpose, name, currency, account_class, normal_balance, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT (organization_id, purpose, currency) DO NOTHING`,
    ).bind(crypto.randomUUID(), organizationId, account.purpose, account.name, currency, account.accountClass, account.normalBalance, now).run();
  }
  const rows = await database.prepare(
    `SELECT id, purpose FROM financial_accounts
     WHERE organization_id = ? AND currency = ? AND purpose IN ('settlement', 'customer_funds')`,
  ).bind(organizationId, currency).all<{ id: string; purpose: 'settlement' | 'customer_funds' }>();
  const settlement = rows.results.find((row) => row.purpose === 'settlement')?.id;
  const customerFunds = rows.results.find((row) => row.purpose === 'customer_funds')?.id;
  if (!settlement || !customerFunds) throw new LedgerError('No se pudieron resolver las cuentas núcleo.', 500, 'ledger_accounts_missing');
  return { settlement, customerFunds };
}

export async function createProductLedgerAccount(input: {
  organizationId: string;
  accountId: string;
  currency: Currency;
  name: string;
}, database: DatabaseClient) {
  const id = crypto.randomUUID();
  await database.prepare(
    `INSERT INTO financial_accounts
      (id, organization_id, purpose, name, currency, account_class, normal_balance, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'liability', 'credit', 'active', ?)`,
  ).bind(id, input.organizationId, `customer_account:${input.accountId}`, input.name, input.currency, new Date().toISOString()).run();
  return id;
}

export async function postJournal(input: {
  organizationId: string;
  transactionId?: string;
  idempotencyKey: string;
  kind: string;
  description: string;
  currency: Currency;
  reversalOf?: string;
  postings: Posting[];
  createdAt?: string;
}, database: DatabaseClient) {
  if (input.postings.length < 2) throw new LedgerError('Un asiento requiere al menos dos partidas.', 500, 'invalid_journal');
  const debits = input.postings.filter((posting) => posting.direction === 'debit').reduce((sum, posting) => sum + posting.amountMinor, 0n);
  const credits = input.postings.filter((posting) => posting.direction === 'credit').reduce((sum, posting) => sum + posting.amountMinor, 0n);
  if (debits <= 0n || debits !== credits || input.postings.some((posting) => posting.amountMinor <= 0n)) {
    throw new LedgerError('El asiento no está balanceado.', 500, 'unbalanced_journal');
  }
  const id = crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  await database.prepare(
    `INSERT INTO ledger_journals
      (id, organization_id, transaction_id, idempotency_key, kind, description, currency, status, reversal_of, posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
  ).bind(
    id, input.organizationId, input.transactionId ?? null, input.idempotencyKey, input.kind,
    input.description, input.currency, input.reversalOf ?? null, createdAt, createdAt,
  ).run();
  await database.batch(input.postings.map((posting) => database.prepare(
    `INSERT INTO ledger_postings (id, organization_id, journal_id, account_id, direction, amount_minor, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.organizationId, id, posting.accountId, posting.direction,
    posting.amountMinor.toString(), input.currency, createdAt,
  )));
  return id;
}

export async function postDisputeCreditInTransaction(input: {
  organizationId: string;
  disputeId: string;
  amountMinor: bigint;
  currency: Currency;
  description: string;
  creditAccountId: string;
}, database: DatabaseClient) {
  const operationKey = `dispute-credit:${input.disputeId}`;
  const existing = await database.prepare(
    `SELECT id, amount_minor::text AS "amountMinor", currency, status FROM transactions
     WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, operationKey).first<{ id: string; amountMinor: string; currency: Currency; status: string }>();
  if (existing) {
    if (BigInt(existing.amountMinor) !== input.amountMinor || existing.currency !== input.currency) {
      throw new LedgerError('El crédito de la disputa no coincide con la operación ya registrada.', 409, 'dispute_credit_mismatch');
    }
    return { transactionId: existing.id, replayed: true };
  }
  if (input.amountMinor <= 0n) throw new LedgerError('El crédito de disputa debe ser positivo.', 400, 'invalid_dispute_credit');
  const accounts = await getOrCreateCoreAccounts(input.organizationId, input.currency, database);
  const target = await database.prepare(
    `SELECT id FROM financial_accounts WHERE organization_id = ? AND id = ? AND currency = ? AND status = 'active'
       AND account_class = 'liability' AND normal_balance = 'credit' LIMIT 1`,
  ).bind(input.organizationId, input.creditAccountId, input.currency).first<{ id: string }>();
  if (!target) throw new LedgerError('La cuenta de crédito de la disputa no es válida.', 409, 'dispute_credit_account_invalid');
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO transactions
      (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
     VALUES (?, ?, ?, 'dispute_credit', 'Cimbra Disputes', ?, ?, ?, 'settled', 0, NULL, ?, ?)`,
  ).bind(id, input.organizationId, operationKey, input.description, input.amountMinor.toString(), input.currency, now, now).run();
  await postJournal({ organizationId: input.organizationId, transactionId: id, idempotencyKey: operationKey,
    kind: 'dispute_credit', description: input.description, currency: input.currency,
    postings: [
      { accountId: accounts.settlement, direction: 'debit', amountMinor: input.amountMinor },
      { accountId: target.id, direction: 'credit', amountMinor: input.amountMinor },
    ], createdAt: now }, database);
  return { transactionId: id, replayed: false };
}

export async function reverseDisputeCreditInTransaction(input: {
  organizationId: string;
  disputeId: string;
  creditTransactionId: string;
}, database: DatabaseClient) {
  const operationKey = `dispute-credit-reversal:${input.disputeId}`;
  const existing = await database.prepare(
    `SELECT id, reversal_of AS "reversalOf" FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, operationKey).first<{ id: string; reversalOf: string | null }>();
  if (existing) {
    if (existing.reversalOf !== input.creditTransactionId) {
      throw new LedgerError('La reversa de crédito no coincide con la operación ya registrada.', 409, 'dispute_credit_reversal_mismatch');
    }
    return { transactionId: existing.id, replayed: true };
  }
  const credit = await database.prepare(
    `SELECT id, description, amount_minor::text AS "amountMinor", currency, status FROM transactions
     WHERE organization_id = ? AND id = ? AND type = 'dispute_credit' FOR UPDATE`,
  ).bind(input.organizationId, input.creditTransactionId).first<{
    id: string; description: string; amountMinor: string; currency: Currency; status: string;
  }>();
  if (!credit) throw new LedgerError('No se encontró el crédito de la disputa.', 409, 'dispute_credit_not_found');
  if (credit.status === 'reversed') {
    const prior = await database.prepare('SELECT id FROM transactions WHERE reversal_of = ? LIMIT 1')
      .bind(credit.id).first<{ id: string }>();
    if (prior) return { transactionId: prior.id, replayed: true };
  }
  if (credit.status !== 'settled') throw new LedgerError('El crédito de disputa no puede compensarse.', 409, 'dispute_credit_not_reversible');
  const originalJournal = await database.prepare(
    `SELECT id FROM ledger_journals WHERE transaction_id = ? AND organization_id = ? LIMIT 1`,
  ).bind(credit.id, input.organizationId).first<{ id: string }>();
  if (!originalJournal) throw new LedgerError('El crédito no tiene asiento contable.', 409, 'journal_missing');
  const postings = await database.prepare(
    `SELECT account_id AS "accountId", direction, amount_minor::text AS "amountMinor"
     FROM ledger_postings WHERE journal_id = ? ORDER BY id`,
  ).bind(originalJournal.id).all<{ accountId: string; direction: Direction; amountMinor: string }>();
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO transactions
      (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
     VALUES (?, ?, ?, 'dispute_credit_reversal', 'Cimbra Disputes', ?, ?, ?, 'settled', 0, ?, ?, ?)`,
  ).bind(id, input.organizationId, operationKey, `Compensación: ${credit.description}`,
    (-BigInt(credit.amountMinor)).toString(), credit.currency, credit.id, now, now).run();
  await postJournal({ organizationId: input.organizationId, transactionId: id, idempotencyKey: operationKey,
    kind: 'dispute_credit_reversal', description: `Compensación del crédito ${credit.id}`, currency: credit.currency,
    reversalOf: originalJournal.id, postings: postings.results.map((posting) => ({
      accountId: posting.accountId, direction: posting.direction === 'debit' ? 'credit' : 'debit', amountMinor: BigInt(posting.amountMinor),
    })), createdAt: now }, database);
  await database.prepare("UPDATE transactions SET status = 'reversed', updated_at = ? WHERE id = ?").bind(now, credit.id).run();
  await database.prepare("UPDATE ledger_journals SET status = 'reversed' WHERE id = ?").bind(originalJournal.id).run();
  return { transactionId: id, replayed: false };
}

export async function accountBalanceMinor(accountId: string, database: DatabaseClient) {
  const result = await database.prepare(
    `SELECT COALESCE(SUM(CASE WHEN p.direction = a.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS balanceMinor
     FROM financial_accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id
     WHERE a.id = ? GROUP BY a.id`,
  ).bind(accountId).first<{ balanceMinor: string }>();
  return BigInt(result?.balanceMinor ?? '0');
}

export async function activeHoldsMinor(accountId: string, database: DatabaseClient) {
  const result = await database.prepare(
    `SELECT COALESCE(SUM(h.amount_minor), 0)::text AS heldMinor
     FROM holds h JOIN transactions t ON t.id = h.transaction_id
     WHERE h.account_id = ? AND h.status = 'active' AND t.type IN ('debit', 'book_transfer')`,
  ).bind(accountId).first<{ heldMinor: string }>();
  return BigInt(result?.heldMinor ?? '0');
}

export type TransferCreationInput = {
  organizationId: string;
  actor: AuthUser;
  idempotencyKey: string;
  counterparty: string;
  description: string;
  amountMinor: bigint;
  currency: Currency;
  signals?: ProtectedRiskSignals;
  transactionId?: string;
  approvalContext?: { requestId: string; requestedBy: string };
};

export async function findTransferByIdempotency(input: TransferCreationInput, database: DatabaseClient) {
  const existing = await database.prepare(
    `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
      risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
     FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(input.organizationId, `transfer:${input.idempotencyKey}`).first<StoredTransaction>();
  if (!existing) return null;
  if (
    existing.counterparty !== input.counterparty || existing.description !== input.description ||
    BigInt(existing.amountMinor) !== -input.amountMinor || existing.currency !== input.currency
  ) {
    throw new LedgerError('La Idempotency-Key ya fue usada con otro payload.', 409, 'idempotency_mismatch');
  }
  try {
    await assessRisk({ organizationId: input.organizationId, idempotencyKey: `transfer:${input.idempotencyKey}`,
      operationType: 'transfer', amountMinor: input.amountMinor, currency: input.currency, counterparty: input.counterparty,
      signals: input.signals }, database);
  } catch (error) {
    if (error instanceof RiskError) throw new LedgerError(error.message, error.status, error.code);
    throw error;
  }
  return serializeTransaction(existing);
}

export async function createTransferInTransaction(input: TransferCreationInput, transaction: DatabaseClient) {
  const operationKey = `transfer:${input.idempotencyKey}`;
  await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:${operationKey}`).first();
  const existing = await findTransferByIdempotency(input, transaction);
  if (existing) {
    return { transaction: existing, replayed: true };
  }

  const accounts = await getOrCreateCoreAccounts(input.organizationId, input.currency, transaction);
  await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
    .bind(accounts.customerFunds).first();
  const current = await accountBalanceMinor(accounts.customerFunds, transaction);
  const held = await activeHoldsMinor(accounts.customerFunds, transaction);
  if (input.amountMinor > current - held) {
    throw new LedgerError('Saldo disponible insuficiente para completar la transferencia.', 422, 'insufficient_funds');
  }

  const assessment = await assessRisk({
    organizationId: input.organizationId, idempotencyKey: operationKey, operationType: 'transfer',
    amountMinor: input.amountMinor, currency: input.currency, counterparty: input.counterparty,
    signals: input.signals,
  }, transaction);
  if (assessment.decision === 'decline') {
    const declined = await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey, actor: input.actor, assessment }, transaction);
    return { declined, replayed: declined.replayed };
  }
  const id = input.transactionId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const status = assessment.decision === 'review' ? 'review' : 'settled';
  const inserted = await transaction.prepare(
      `INSERT INTO transactions
        (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
       VALUES (?, ?, ?, 'debit', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
  ).bind(
      id, input.organizationId, operationKey, input.counterparty, input.description,
      (-input.amountMinor).toString(), input.currency, status, assessment.score, now, now,
  ).first<{ id: string }>();
  if (!inserted) {
    const replay = await transaction.prepare(
        `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
          risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
         FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, operationKey).first<StoredTransaction>();
    if (!replay) throw new LedgerError('No se pudo resolver la operación idempotente.', 409, 'idempotency_conflict');
    return { transaction: serializeTransaction(replay), replayed: true };
  }

  let holdId: string | null = null;
  if (status === 'review') {
    holdId = crypto.randomUUID();
    await transaction.prepare(
        `INSERT INTO holds
          (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
        holdId, input.organizationId, accounts.customerFunds, id, operationKey,
        input.amountMinor.toString(), input.currency, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), now, now,
    ).run();
  } else {
    await postJournal({
        organizationId: input.organizationId,
        transactionId: id,
        idempotencyKey: operationKey,
        kind: 'transfer',
        description: input.description,
        currency: input.currency,
        postings: [
          { accountId: accounts.customerFunds, direction: 'debit', amountMinor: input.amountMinor },
          { accountId: accounts.settlement, direction: 'credit', amountMinor: input.amountMinor },
        ],
        createdAt: now,
    }, transaction);
  }
  await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey, actor: input.actor, assessment, resourceId: id, holdId }, transaction);
  await insertAudit(transaction, {
    organizationId: input.organizationId,
    actorId: input.actor.userId,
    action: 'transfer.created',
    resourceType: 'transaction',
    resourceId: id,
    payload: { amountMinor: input.amountMinor.toString(), currency: input.currency, status, riskScore: assessment.score,
      riskDecision: assessment.decision, approvalRequestId: input.approvalContext?.requestId ?? null,
      requestedBy: input.approvalContext?.requestedBy ?? null },
  });
  return {
    transaction: serializeTransaction({
      id, counterparty: input.counterparty, description: input.description, amountMinor: (-input.amountMinor).toString(),
      currency: input.currency, status, riskScore: assessment.score, reversalOf: null, createdAt: now,
    }),
    replayed: false,
  };
}

export type AccountPaymentInput = {
  organizationId: string;
  actor: AuthUser;
  idempotencyKey: string;
  accountId: string;
  direction: 'cash_in' | 'cash_out';
  counterparty: string;
  description: string;
  amountMinor: bigint;
  currency: Currency;
  signals?: ProtectedRiskSignals;
};

export async function createAccountPayment(input: AccountPaymentInput) {
  return getDatabaseClient().transaction((transaction) => createAccountPaymentInTransaction(input, transaction));
}

export async function createAccountPaymentInTransaction(input: AccountPaymentInput, transaction: DatabaseClient) {
    const operationKey = `payment:${input.idempotencyKey}`;
    await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:${operationKey}`).first();
    const existing = await transaction.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
        risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, operationKey).first<StoredTransaction>();
    const signedAmount = input.direction === 'cash_in' ? input.amountMinor : -input.amountMinor;
    if (existing) {
      if (existing.counterparty !== input.counterparty || existing.description !== input.description ||
          BigInt(existing.amountMinor) !== signedAmount || existing.currency !== input.currency) {
        throw new LedgerError('La Idempotency-Key ya fue usada con otro payload.', 409, 'idempotency_mismatch');
      }
      try {
        await assessRisk({ organizationId: input.organizationId, idempotencyKey: operationKey, operationType: input.direction,
          amountMinor: input.amountMinor, currency: input.currency, counterparty: input.counterparty, signals: input.signals }, transaction);
      } catch (error) {
        if (error instanceof RiskError) throw new LedgerError(error.message, error.status, error.code);
        throw error;
      }
      return { payment: serializeTransaction(existing), replayed: true };
    }
    const account = await transaction.prepare(
      `SELECT a.ledger_account_id AS "ledgerAccountId", a.currency, a.status
       FROM accounts a WHERE a.id = ? AND a.organization_id = ? LIMIT 1 FOR UPDATE`,
    ).bind(input.accountId, input.organizationId).first<{ ledgerAccountId: string; currency: Currency; status: string }>();
    if (!account) throw new LedgerError('Cuenta no encontrada.', 404, 'account_not_found');
    if (account.status !== 'active') throw new LedgerError('La cuenta no está activa.', 409, 'account_inactive');
    if (account.currency !== input.currency) throw new LedgerError('La moneda no coincide con la cuenta.', 409, 'currency_mismatch');
    if (input.direction === 'cash_out') {
      const current = await accountBalanceMinor(account.ledgerAccountId, transaction);
      const held = await activeHoldsMinor(account.ledgerAccountId, transaction);
      if (input.amountMinor > current - held) throw new LedgerError('Saldo disponible insuficiente.', 422, 'insufficient_funds');
    }
    const assessment = await assessRisk({
      organizationId: input.organizationId, idempotencyKey: operationKey, operationType: input.direction,
      amountMinor: input.amountMinor, currency: input.currency, counterparty: input.counterparty,
      signals: input.signals,
    }, transaction);
    if (assessment.decision === 'decline') {
      const declined = await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey, actor: input.actor, assessment }, transaction);
      return { declined, replayed: declined.replayed };
    }
    const core = await getOrCreateCoreAccounts(input.organizationId, input.currency, transaction);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status = assessment.decision === 'review' ? 'review' : 'settled';
    await transaction.prepare(
      `INSERT INTO transactions
        (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(id, input.organizationId, operationKey, input.direction === 'cash_in' ? 'credit' : 'debit', input.counterparty,
      input.description, signedAmount.toString(), input.currency, status, assessment.score, now, now).run();
    let holdId: string | null = null;
    if (status === 'review') {
      holdId = crypto.randomUUID();
      await transaction.prepare(
        `INSERT INTO holds
          (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(holdId, input.organizationId, account.ledgerAccountId, id, operationKey, input.amountMinor.toString(),
        input.currency, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), now, now).run();
    } else {
      await postJournal({
        organizationId: input.organizationId, transactionId: id, idempotencyKey: operationKey,
        kind: input.direction, description: input.description, currency: input.currency,
        postings: input.direction === 'cash_in' ? [
          { accountId: core.settlement, direction: 'debit', amountMinor: input.amountMinor },
          { accountId: account.ledgerAccountId, direction: 'credit', amountMinor: input.amountMinor },
        ] : [
          { accountId: account.ledgerAccountId, direction: 'debit', amountMinor: input.amountMinor },
          { accountId: core.settlement, direction: 'credit', amountMinor: input.amountMinor },
        ], createdAt: now,
      }, transaction);
    }
    await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey, actor: input.actor, assessment, resourceId: id, holdId }, transaction);
    await insertAudit(transaction, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'payment.created',
      resourceType: 'transaction', resourceId: id,
      payload: { accountId: input.accountId, direction: input.direction, amountMinor: input.amountMinor.toString(), currency: input.currency, status, riskScore: assessment.score, riskDecision: assessment.decision },
    });
    return { payment: serializeTransaction({ id, counterparty: input.counterparty, description: input.description,
      amountMinor: signedAmount.toString(), currency: input.currency, status, riskScore: assessment.score, reversalOf: null, createdAt: now }), replayed: false };
}

export type ReverseTransactionInput = {
  organizationId: string;
  actor: AuthUser;
  transactionId: string;
  idempotencyKey: string;
  auditAction?: 'transfer.reversed' | 'bill_payment.reversed' | 'book_transfer.reversed' | 'instant_transfer.returned' | 'collection.refunded';
};

export async function reverseTransfer(input: ReverseTransactionInput) {
  return getDatabaseClient().transaction((transaction) => reverseTransactionInTransaction(input, transaction));
}

export async function reverseTransactionInTransaction(input: ReverseTransactionInput, transaction: DatabaseClient) {
    const operationKey = `reversal:${input.idempotencyKey}`;
    const existingReversal = await transaction.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
        risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, operationKey).first<StoredTransaction>();
    if (existingReversal) {
      if (existingReversal.reversalOf !== input.transactionId) {
        throw new LedgerError('La Idempotency-Key ya fue usada para otra reversa.', 409, 'idempotency_mismatch');
      }
      return { transaction: serializeTransaction(existingReversal), replayed: true };
    }

    const original = await transaction.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
        risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
       FROM transactions WHERE id = ? AND organization_id = ? FOR UPDATE`,
    ).bind(input.transactionId, input.organizationId).first<StoredTransaction>();
    if (!original) throw new LedgerError('Transferencia no encontrada.', 404, 'transaction_not_found');
    if ((input.auditAction ?? 'transfer.reversed') === 'transfer.reversed') {
      const billPayment = await transaction.prepare('SELECT id FROM bill_payment_orders WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
        .bind(input.organizationId, original.id).first<{ id: string }>();
      if (billPayment) throw new LedgerError('Esta transacción debe revertirse desde su orden de servicio.', 409, 'bill_payment_reverse_required');
      const bookTransfer = await transaction.prepare('SELECT id FROM book_transfers WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
        .bind(input.organizationId, original.id).first<{ id: string }>();
      if (bookTransfer) throw new LedgerError('Esta transacción debe revertirse desde su book transfer.', 409, 'book_transfer_reverse_required');
      const instantTransfer = await transaction.prepare('SELECT id FROM instant_transfers WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
        .bind(input.organizationId, original.id).first<{ id: string }>();
      if (instantTransfer) throw new LedgerError('Esta transacción debe revertirse desde su transferencia instantánea.', 409, 'instant_transfer_return_required');
      const paymentLink = await transaction.prepare('SELECT id FROM payment_links WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
        .bind(input.organizationId, original.id).first<{ id: string }>();
      if (paymentLink) throw new LedgerError('Esta transacción debe revertirse desde su link de cobro.', 409, 'collection_refund_required');
    }
    if (original.status !== 'settled') throw new LedgerError('Sólo se puede revertir una transferencia liquidada.', 409, 'transaction_not_reversible');
    const alreadyReversed = await transaction.prepare('SELECT id FROM transactions WHERE reversal_of = ? LIMIT 1')
      .bind(original.id).first<{ id: string }>();
    if (alreadyReversed) throw new LedgerError('La transferencia ya fue revertida.', 409, 'transaction_already_reversed');

    const originalJournal = await transaction.prepare(
      `SELECT id FROM ledger_journals WHERE transaction_id = ? AND organization_id = ? LIMIT 1`,
    ).bind(original.id, input.organizationId).first<{ id: string }>();
    if (!originalJournal) throw new LedgerError('La transferencia no tiene un asiento contable.', 409, 'journal_missing');
    const postings = await transaction.prepare(
      `SELECT account_id AS accountId, direction, amount_minor::text AS amountMinor
       FROM ledger_postings WHERE journal_id = ? ORDER BY id`,
    ).bind(originalJournal.id).all<{ accountId: string; direction: Direction; amountMinor: string }>();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await transaction.prepare(
      `INSERT INTO transactions
        (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
       VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, 'settled', 0, ?, ?, ?)`,
    ).bind(
      id, input.organizationId, operationKey, original.counterparty, `Reversa: ${original.description}`,
      (-BigInt(original.amountMinor)).toString(), original.currency, original.id, now, now,
    ).run();
    await postJournal({
      organizationId: input.organizationId,
      transactionId: id,
      idempotencyKey: operationKey,
      kind: 'reversal',
      description: `Reversa de ${original.id}`,
      currency: original.currency,
      reversalOf: originalJournal.id,
      postings: postings.results.map((posting) => ({
        accountId: posting.accountId,
        direction: posting.direction === 'debit' ? 'credit' : 'debit',
        amountMinor: BigInt(posting.amountMinor),
      })),
      createdAt: now,
    }, transaction);
    await transaction.prepare("UPDATE transactions SET status = 'reversed', updated_at = ? WHERE id = ?").bind(now, original.id).run();
    await transaction.prepare("UPDATE ledger_journals SET status = 'reversed' WHERE id = ?").bind(originalJournal.id).run();
    const bookTransfer = await transaction.prepare(`SELECT id, status FROM book_transfers
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, original.id).first<{ id: string; status: string }>();
    if (bookTransfer) {
      if (input.auditAction !== 'book_transfer.reversed') {
        throw new LedgerError('La reversa del book transfer debe usar su operación canónica.', 409, 'book_transfer_reverse_required');
      }
      await transaction.prepare(`UPDATE book_transfers SET status = 'reversed', reversal_transaction_id = ?, reversed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(id, now, now, bookTransfer.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'book_transfer.reversed',
        resourceType: 'book_transfer', resourceId: bookTransfer.id, payload: { transactionId: original.id, reversalId: id },
      });
    }
    const instantTransfer = await transaction.prepare(`SELECT id, status FROM instant_transfers
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, original.id).first<{ id: string; status: string }>();
    if (instantTransfer) {
      if (input.auditAction !== 'instant_transfer.returned') {
        throw new LedgerError('La devolución de la transferencia instantánea debe usar su operación canónica.', 409, 'instant_transfer_return_required');
      }
      await transaction.prepare(`UPDATE instant_transfers SET status = 'returned', reversal_transaction_id = ?, updated_at = ? WHERE id = ?`)
        .bind(id, now, instantTransfer.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.transfer_returned',
        resourceType: 'instant_transfer', resourceId: instantTransfer.id, payload: { transactionId: original.id, reversalId: id },
      });
    }
    const paymentLink = await transaction.prepare(`SELECT id, status FROM payment_links
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, original.id).first<{ id: string; status: string }>();
    if (paymentLink) {
      if (input.auditAction !== 'collection.refunded') {
        throw new LedgerError('La devolución del cobro debe usar su operación canónica.', 409, 'collection_refund_required');
      }
      await transaction.prepare(`UPDATE payment_links SET status = 'refunded', reversal_transaction_id = ?, updated_at = ? WHERE id = ?`)
        .bind(id, now, paymentLink.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_refunded',
        resourceType: 'payment_link', resourceId: paymentLink.id, payload: { transactionId: original.id, reversalId: id },
      });
    }
    const payoutItem = await transaction.prepare(`SELECT id, batch_id AS "batchId", external_reference AS "externalReference", status
      FROM payout_items WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, original.id).first<{ id: string; batchId: string; externalReference: string; status: string }>();
    if (payoutItem && payoutItem.status === 'settled') {
      await transaction.prepare(`UPDATE payout_items SET status = 'failed', failure_code = 'payout_reversed',
        failure_message = 'El payout fue compensado mediante una reversa contable.', processed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, payoutItem.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        action: 'payout.item_failed',
        resourceType: 'payout_item',
        resourceId: payoutItem.id,
        payload: { batchId: payoutItem.batchId, externalReference: payoutItem.externalReference,
          transactionId: original.id, reversalId: id, failureCode: 'payout_reversed' },
      });
      const batch = await transaction.prepare('SELECT status FROM payout_batches WHERE organization_id = ? AND id = ? FOR UPDATE')
        .bind(input.organizationId, payoutItem.batchId).first<{ status: string }>();
      const countsRows = await transaction.prepare(`SELECT status, COUNT(*)::int AS count FROM payout_items
        WHERE organization_id = ? AND batch_id = ? GROUP BY status`).bind(input.organizationId, payoutItem.batchId)
        .all<{ status: string; count: number }>();
      const counts = { pending: 0, processing: 0, review: 0, settled: 0, failed: 0, cancelled: 0 };
      for (const count of countsRows.results) if (count.status in counts) counts[count.status as keyof typeof counts] = Number(count.count);
      const batchStatus = counts.review > 0 ? 'requires_attention'
        : counts.pending + counts.processing > 0 ? 'processing'
          : counts.settled > 0 && counts.failed + counts.cancelled > 0 ? 'partially_failed'
            : counts.settled > 0 ? 'completed' : 'failed';
      await transaction.prepare('UPDATE payout_batches SET status = ?, completed_at = ?, processing_lease_until = NULL, updated_at = ? WHERE id = ?')
        .bind(batchStatus, ['completed', 'partially_failed', 'failed'].includes(batchStatus) ? now : null, now, payoutItem.batchId).run();
      if (batch && batch.status !== batchStatus) await insertAudit(transaction, {
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        action: `payout.batch_${batchStatus}`,
        resourceType: 'payout_batch',
        resourceId: payoutItem.batchId,
        payload: { status: batchStatus, counts, reversalId: id },
      });
    }
    if (!bookTransfer && !instantTransfer && !paymentLink) {
      await insertAudit(transaction, {
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        action: input.auditAction ?? 'transfer.reversed',
        resourceType: 'transaction',
        resourceId: original.id,
        payload: { reversalId: id },
      });
    }
    return {
      transaction: serializeTransaction({
        ...original, id, amountMinor: (-BigInt(original.amountMinor)).toString(), status: 'settled',
        riskScore: 0, reversalOf: original.id, description: `Reversa: ${original.description}`, createdAt: now,
      }),
      replayed: false,
    };
}

export async function resolveHold(input: {
  organizationId: string;
  actor: AuthUser;
  holdId: string;
  action: 'capture' | 'release';
  idempotencyKey: string;
  approvalAuthorized?: boolean;
}, database: DatabaseClient = getDatabaseClient()) {
  return database.transaction(async (transaction) => {
    await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:hold-resolution:${input.idempotencyKey}`).run();
    const keyOwner = await transaction.prepare(
      `SELECT resource_id AS id FROM audit_events
       WHERE organization_id = ? AND resource_type = 'hold'
         AND action IN ('hold.captured', 'hold.released')
         AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
    if (keyOwner && keyOwner.id !== input.holdId) {
      throw new LedgerError('Idempotency-Key ya fue usado para resolver otra reserva.', 409, 'idempotency_mismatch');
    }
    const hold = await transaction.prepare(
      `SELECT h.id, h.account_id AS accountId, h.transaction_id AS transactionId, h.amount_minor::text AS amountMinor,
        h.currency, h.status, t.description, t.type
       FROM holds h JOIN transactions t ON t.id = h.transaction_id
       WHERE h.id = ? AND h.organization_id = ? FOR UPDATE`,
    ).bind(input.holdId, input.organizationId).first<{
      id: string; accountId: string; transactionId: string; amountMinor: string;
      currency: Currency; status: string; description: string; type: 'credit' | 'debit' | 'book_transfer';
    }>();
    if (!hold) throw new LedgerError('Reserva no encontrada.', 404, 'hold_not_found');
    if (hold.status !== 'active') {
      const expectedStatus = input.action === 'capture' ? 'captured' : 'released';
      const resolution = await transaction.prepare(
        `SELECT payload FROM audit_events WHERE organization_id = ? AND resource_type = 'hold' AND resource_id = ?
         AND action IN ('hold.captured', 'hold.released') ORDER BY created_at DESC LIMIT 1`,
      ).bind(input.organizationId, hold.id).first<{ payload: string }>();
      let priorKey: string | null = null;
      try { priorKey = resolution ? String((JSON.parse(resolution.payload) as { idempotencyKey?: unknown }).idempotencyKey ?? '') || null : null; } catch { /* legacy audit payload */ }
      if (hold.status === expectedStatus && (priorKey === null || priorKey === input.idempotencyKey)) {
        return { id: hold.id, status: hold.status, replayed: true };
      }
      throw new LedgerError('La reserva ya fue resuelta con otra operación.', 409, 'hold_already_resolved');
    }
    if (!input.approvalAuthorized) {
      await transaction.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
        .bind(`${input.organizationId}:approval-policy:risk.case.resolve`).first();
      const protectedCase = await transaction.prepare(
        `SELECT rc.id FROM risk_cases rc
         JOIN approval_policies ap ON ap.organization_id = rc.organization_id
           AND ap.action_type = 'risk.case.resolve' AND ap.enabled = 1
         WHERE rc.organization_id = ? AND rc.hold_id = ? AND rc.status = 'open' LIMIT 1`,
      ).bind(input.organizationId, hold.id).first<{ id: string }>();
      if (protectedCase) {
        throw new LedgerError(
          'La reserva pertenece a un caso protegido; resolvé el caso mediante doble aprobación.',
          409,
          'risk_case_approval_required',
        );
      }
    }
    await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
      .bind(hold.accountId).first();
    const now = new Date().toISOString();
    const bookTransfer = await transaction.prepare(`SELECT bt.id, bt.destination_account_id AS "destinationAccountId",
        destination.ledger_account_id AS "destinationLedgerAccountId", bt.status
      FROM book_transfers bt JOIN accounts destination ON destination.id = bt.destination_account_id
      WHERE bt.organization_id = ? AND bt.transaction_id = ? LIMIT 1 FOR UPDATE OF bt`)
      .bind(input.organizationId, hold.transactionId).first<{
        id: string; destinationAccountId: string; destinationLedgerAccountId: string; status: string;
      }>();
    if (bookTransfer) {
      await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
        .bind(bookTransfer.destinationLedgerAccountId).first();
    }
    const instantTransfer = await transaction.prepare(`SELECT it.id, it.destination_account_id AS "destinationAccountId",
        destination.ledger_account_id AS "destinationLedgerAccountId", it.status
      FROM instant_transfers it JOIN accounts destination ON destination.id = it.destination_account_id
      WHERE it.organization_id = ? AND it.transaction_id = ? AND it.destination_account_id IS NOT NULL
      LIMIT 1 FOR UPDATE OF it`)
      .bind(input.organizationId, hold.transactionId).first<{
        id: string; destinationAccountId: string; destinationLedgerAccountId: string; status: string;
      }>();
    if (instantTransfer) {
      await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
        .bind(instantTransfer.destinationLedgerAccountId).first();
    }
    const collectionLink = await transaction.prepare(`SELECT pl.id, pl.account_id AS "destinationAccountId",
        merchant.ledger_account_id AS "destinationLedgerAccountId", pl.status, pl.paid_method AS "paidMethod"
      FROM payment_links pl JOIN accounts merchant ON merchant.id = pl.account_id
      WHERE pl.organization_id = ? AND pl.transaction_id = ? AND pl.paid_method = 'internal'
      LIMIT 1 FOR UPDATE OF pl`)
      .bind(input.organizationId, hold.transactionId).first<{
        id: string; destinationAccountId: string; destinationLedgerAccountId: string; status: string; paidMethod: string;
      }>();
    if (collectionLink) {
      await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
        .bind(collectionLink.destinationLedgerAccountId).first();
    }
    const internalDestination = bookTransfer ?? instantTransfer ?? collectionLink;
    if (input.action === 'capture') {
      const accounts = internalDestination ? null : await getOrCreateCoreAccounts(input.organizationId, hold.currency, transaction);
      await postJournal({
        organizationId: input.organizationId,
        transactionId: hold.transactionId,
        idempotencyKey: `hold:capture:${hold.id}`,
        kind: bookTransfer ? 'book_transfer' : instantTransfer ? 'instant_transfer' : collectionLink ? 'collection' : 'hold_capture',
        description: hold.description,
        currency: hold.currency,
        postings: internalDestination ? [
          { accountId: hold.accountId, direction: 'debit', amountMinor: BigInt(hold.amountMinor) },
          { accountId: internalDestination.destinationLedgerAccountId, direction: 'credit', amountMinor: BigInt(hold.amountMinor) },
        ] : hold.type === 'credit' ? [
          { accountId: accounts!.settlement, direction: 'debit', amountMinor: BigInt(hold.amountMinor) },
          { accountId: hold.accountId, direction: 'credit', amountMinor: BigInt(hold.amountMinor) },
        ] : [
          { accountId: hold.accountId, direction: 'debit', amountMinor: BigInt(hold.amountMinor) },
          { accountId: accounts!.settlement, direction: 'credit', amountMinor: BigInt(hold.amountMinor) },
        ],
        createdAt: now,
      }, transaction);
      await transaction.prepare("UPDATE holds SET status = 'captured', updated_at = ? WHERE id = ?").bind(now, hold.id).run();
      await transaction.prepare("UPDATE transactions SET status = 'settled', updated_at = ? WHERE id = ?").bind(now, hold.transactionId).run();
    } else {
      await transaction.prepare("UPDATE holds SET status = 'released', updated_at = ? WHERE id = ?").bind(now, hold.id).run();
      await transaction.prepare("UPDATE transactions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, hold.transactionId).run();
    }
    if (bookTransfer && bookTransfer.status === 'review') {
      const transferStatus = input.action === 'capture' ? 'settled' : 'cancelled';
      await transaction.prepare('UPDATE book_transfers SET status = ?, updated_at = ? WHERE id = ?')
        .bind(transferStatus, now, bookTransfer.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: `book_transfer.${transferStatus}`,
        resourceType: 'book_transfer', resourceId: bookTransfer.id,
        payload: { transactionId: hold.transactionId, holdId: hold.id, status: transferStatus },
      });
    }
    const pendingInstant = await transaction.prepare(`SELECT id, status FROM instant_transfers
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, hold.transactionId).first<{ id: string; status: string }>();
    if (pendingInstant && pendingInstant.status === 'pending') {
      const transferStatus = input.action === 'capture' ? 'settled' : 'cancelled';
      await transaction.prepare('UPDATE instant_transfers SET status = ?, updated_at = ? WHERE id = ?')
        .bind(transferStatus, now, pendingInstant.id).run();
      if (transferStatus === 'settled') {
        await transaction.prepare(`UPDATE payment_qrs SET status = 'paid', paid_transfer_id = ?, updated_at = ?
          WHERE organization_id = ? AND status = 'active' AND payload = (SELECT qr_payload FROM instant_transfers WHERE id = ?)`)
          .bind(pendingInstant.id, now, input.organizationId, pendingInstant.id).run();
      }
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: `instant.transfer_${transferStatus}`,
        resourceType: 'instant_transfer', resourceId: pendingInstant.id,
        payload: { transactionId: hold.transactionId, holdId: hold.id, status: transferStatus },
      });
    }
    const pendingCollection = await transaction.prepare(`SELECT id, status FROM payment_links
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, hold.transactionId).first<{ id: string; status: string }>();
    if (pendingCollection && pendingCollection.status === 'pending') {
      const linkStatus = input.action === 'capture' ? 'paid' : 'cancelled';
      await transaction.prepare('UPDATE payment_links SET status = ?, updated_at = ? WHERE id = ?')
        .bind(linkStatus, now, pendingCollection.id).run();
      await insertAudit(transaction, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: `collection.link_${linkStatus === 'paid' ? 'paid' : 'cancelled'}`,
        resourceType: 'payment_link', resourceId: pendingCollection.id,
        payload: { transactionId: hold.transactionId, holdId: hold.id, status: linkStatus },
      });
    }
    const billPayment = await transaction.prepare(`SELECT id, obligation_id AS "obligationId", status FROM bill_payment_orders
      WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, hold.transactionId).first<{ id: string; obligationId: string | null; status: string }>();
    if (billPayment && billPayment.status === 'review') {
      const orderStatus = input.action === 'capture' ? 'settled' : 'cancelled';
      await transaction.prepare(`UPDATE bill_payment_orders SET status = ?, settled_at = ?, updated_at = ? WHERE id = ?`)
        .bind(orderStatus, input.action === 'capture' ? now : null, now, billPayment.id).run();
      if (billPayment.obligationId && input.action === 'capture') {
        await transaction.prepare("UPDATE biller_obligations SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?")
          .bind(now, now, billPayment.obligationId).run();
      }
      await insertAudit(transaction, {
        organizationId: input.organizationId,
        actorId: input.actor.userId,
        action: `bill_payment.${orderStatus}`,
        resourceType: 'bill_payment_order',
        resourceId: billPayment.id,
        payload: { transactionId: hold.transactionId, holdId: hold.id, status: orderStatus },
      });
    }
    const payoutItem = await transaction.prepare(`SELECT id, batch_id AS "batchId", external_reference AS "externalReference", status
      FROM payout_items WHERE organization_id = ? AND transaction_id = ? LIMIT 1 FOR UPDATE`)
      .bind(input.organizationId, hold.transactionId).first<{ id: string; batchId: string; externalReference: string; status: string }>();
    if (payoutItem && payoutItem.status === 'review') {
      const itemStatus = input.action === 'capture' ? 'settled' : 'failed';
      await transaction.prepare(`UPDATE payout_items SET status = ?, failure_code = ?, failure_message = ?, processed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(itemStatus, input.action === 'capture' ? null : 'risk_released',
          input.action === 'capture' ? null : 'La revisión de riesgo liberó la reserva.', now, now, payoutItem.id).run();
      await insertAudit(transaction, { organizationId: input.organizationId, actorId: input.actor.userId,
        action: `payout.item_${itemStatus}`, resourceType: 'payout_item', resourceId: payoutItem.id,
        payload: { batchId: payoutItem.batchId, externalReference: payoutItem.externalReference,
          transactionId: hold.transactionId, holdId: hold.id, status: itemStatus,
          ...(itemStatus === 'failed' ? { failureCode: 'risk_released' } : {}) } });
      const batch = await transaction.prepare('SELECT status, created_by AS "createdBy" FROM payout_batches WHERE organization_id = ? AND id = ? FOR UPDATE')
        .bind(input.organizationId, payoutItem.batchId).first<{ status: string; createdBy: string }>();
      const countsRows = await transaction.prepare(`SELECT status, COUNT(*)::int AS count FROM payout_items
        WHERE organization_id = ? AND batch_id = ? GROUP BY status`).bind(input.organizationId, payoutItem.batchId)
        .all<{ status: string; count: number }>();
      const counts = { pending: 0, processing: 0, review: 0, settled: 0, failed: 0, cancelled: 0 };
      for (const count of countsRows.results) if (count.status in counts) counts[count.status as keyof typeof counts] = Number(count.count);
      const batchStatus = counts.review > 0 ? 'requires_attention'
        : counts.pending + counts.processing > 0 ? 'processing'
          : counts.settled > 0 && counts.failed + counts.cancelled > 0 ? 'partially_failed'
            : counts.settled > 0 ? 'completed' : 'failed';
      const completedAt = ['completed', 'partially_failed', 'failed'].includes(batchStatus) ? now : null;
      await transaction.prepare('UPDATE payout_batches SET status = ?, completed_at = ?, processing_lease_until = NULL, updated_at = ? WHERE id = ?')
        .bind(batchStatus, completedAt, now, payoutItem.batchId).run();
      if (batch && batch.status !== batchStatus) await insertAudit(transaction, { organizationId: input.organizationId,
        actorId: input.actor.userId, action: `payout.batch_${batchStatus}`, resourceType: 'payout_batch', resourceId: payoutItem.batchId,
        payload: { status: batchStatus, counts } });
    }
    await insertAudit(transaction, {
      organizationId: input.organizationId,
      actorId: input.actor.userId,
      action: `hold.${input.action === 'capture' ? 'captured' : 'released'}`,
      resourceType: 'hold',
      resourceId: hold.id,
      payload: { transactionId: hold.transactionId, idempotencyKey: input.idempotencyKey },
    });
    return { id: hold.id, status: input.action === 'capture' ? 'captured' : 'released', replayed: false };
  });
}

export async function seedOrganizationLedger(organizationId: string) {
  const rows = [
    ['seed-0', 'Pago QR · Mercado Uno', 'Cobro QR interoperable', '82450', 'ARS', 'settled', 4],
    ['seed-1', 'Transferencia CVU', 'Ingreso desde cuenta bancaria', '210000', 'ARS', 'settled', 8],
    ['seed-2', 'Cloud Services', 'Tarjeta corporativa terminada en 4821', '-480', 'USD', 'authorized', 12],
    ['seed-3', 'Distribuidora Andina', 'Pago a proveedor', '-128500', 'ARS', 'settled', 18],
    ['seed-4', 'Marketplace Centro', 'Operación en revisión histórica', '315900', 'ARS', 'review', 72],
    ['seed-v2-capital-ars', 'Capital sandbox ARS', 'Fondeo contable para pruebas', '5000000', 'ARS', 'settled', 3],
    ['seed-v2-capital-usd', 'Capital sandbox USD', 'Fondeo contable para pruebas', '10000', 'USD', 'settled', 3],
    ['seed-v2-review-ars', 'Marketplace Centro', 'Liquidación split', '-150000', 'ARS', 'review', 72],
  ] as const;
  await getDatabaseClient().transaction(async (transaction) => {
    const now = Date.now();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const currency = row[4] as Currency;
      const amountMinor = majorToMinor(row[3].replace('-', ''), currency) * (row[3].startsWith('-') ? -1n : 1n);
      const createdAt = new Date(now - index * 2_700_000).toISOString();
      const id = crypto.randomUUID();
      const inserted = await transaction.prepare(
        `INSERT INTO transactions
          (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
      ).bind(
        id, organizationId, row[0], amountMinor >= 0n ? 'credit' : 'debit', row[1], row[2],
        amountMinor.toString(), currency, row[5], row[6], createdAt, createdAt,
      ).first<{ id: string }>();
      if (!inserted) continue;
      const accounts = await getOrCreateCoreAccounts(organizationId, currency, transaction);
      if (row[5] === 'settled') {
        const amount = amountMinor < 0n ? -amountMinor : amountMinor;
        await postJournal({
          organizationId,
          transactionId: id,
          idempotencyKey: `seed:${index}`,
          kind: amountMinor >= 0n ? 'funding' : 'transfer',
          description: row[2],
          currency,
          postings: amountMinor >= 0n ? [
            { accountId: accounts.settlement, direction: 'debit', amountMinor: amount },
            { accountId: accounts.customerFunds, direction: 'credit', amountMinor: amount },
          ] : [
            { accountId: accounts.customerFunds, direction: 'debit', amountMinor: amount },
            { accountId: accounts.settlement, direction: 'credit', amountMinor: amount },
          ],
          createdAt,
        }, transaction);
      } else if ((row[5] === 'authorized' || row[5] === 'review') && amountMinor < 0n) {
        await transaction.prepare(
          `INSERT INTO holds
            (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), organizationId, accounts.customerFunds, id, `seed-hold-${index}`,
          (-amountMinor).toString(), currency, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), createdAt, createdAt,
        ).run();
      }
    }
  });
}

export type LedgerBalance = {
  currency: Currency;
  current: number;
  available: number;
  held: number;
  currentMinor: string;
  availableMinor: string;
  heldMinor: string;
};

export async function getLedgerBalances(organizationId: string): Promise<LedgerBalance[]> {
  const rows = await getDatabaseClient().prepare(
    `SELECT a.currency,
      COALESCE(SUM(CASE WHEN p.direction = a.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS currentMinor,
      COALESCE((SELECT SUM(h.amount_minor) FROM holds h WHERE h.account_id = a.id AND h.status = 'active'), 0)::text AS heldMinor
     FROM financial_accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id
     WHERE a.organization_id = ? AND a.purpose = 'customer_funds'
     GROUP BY a.id, a.currency ORDER BY a.currency`,
  ).bind(organizationId).all<{ currency: Currency; currentMinor: string; heldMinor: string }>();
  return rows.results.map((row) => {
    const current = BigInt(row.currentMinor);
    const held = BigInt(row.heldMinor);
    const available = current - held;
    return {
      currency: row.currency,
      current: minorToMajorNumber(current, row.currency),
      available: minorToMajorNumber(available, row.currency),
      held: minorToMajorNumber(held, row.currency),
      currentMinor: current.toString(),
      availableMinor: available.toString(),
      heldMinor: held.toString(),
    };
  });
}

export async function listLedgerJournals(organizationId: string) {
  const rows = await getDatabaseClient().prepare(
    `SELECT j.id, j.transaction_id AS transactionId, j.kind, j.description, j.currency, j.status,
      j.reversal_of AS reversalOf, j.posted_at AS postedAt,
      COALESCE(SUM(CASE WHEN p.direction = 'debit' THEN p.amount_minor ELSE 0 END), 0)::text AS amountMinor,
      COUNT(p.id)::int AS postingCount
     FROM ledger_journals j LEFT JOIN ledger_postings p ON p.journal_id = j.id
     WHERE j.organization_id = ?
     GROUP BY j.id ORDER BY j.created_at DESC LIMIT 100`,
  ).bind(organizationId).all<{
    id: string; transactionId: string | null; kind: string; description: string; currency: Currency;
    status: string; reversalOf: string | null; postedAt: string; amountMinor: string; postingCount: number;
  }>();
  return rows.results.map((row) => ({
    ...row,
    amount: minorToMajorNumber(row.amountMinor, row.currency),
  }));
}

export type ActiveHold = {
  id: string;
  transactionId: string;
  amountMinor: string;
  amount: number;
  currency: Currency;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  counterparty: string;
  description: string;
};

export async function listActiveHolds(organizationId: string): Promise<ActiveHold[]> {
  const rows = await getDatabaseClient().prepare(
    `SELECT h.id, h.transaction_id AS transactionId, h.amount_minor::text AS amountMinor, h.currency,
      h.status, h.expires_at AS expiresAt, h.created_at AS createdAt, t.counterparty, t.description
     FROM holds h JOIN transactions t ON t.id = h.transaction_id
     WHERE h.organization_id = ? AND h.status = 'active'
     ORDER BY h.created_at DESC LIMIT 100`,
  ).bind(organizationId).all<{
    id: string; transactionId: string; amountMinor: string; currency: Currency; status: string;
    expiresAt: string | null; createdAt: string; counterparty: string; description: string;
  }>();
  return rows.results.map((row) => ({ ...row, amount: minorToMajorNumber(row.amountMinor, row.currency) }));
}

export function serializeTransaction(transaction: StoredTransaction) {
  return {
    id: transaction.id,
    counterparty: transaction.counterparty,
    description: transaction.description,
    amount: minorToMajorNumber(transaction.amountMinor, transaction.currency),
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    status: transaction.status,
    riskScore: Number(transaction.riskScore),
    reversalOf: transaction.reversalOf,
    createdAt: transaction.createdAt,
  };
}
