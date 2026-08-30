import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import {
  accountBalanceMinor, activeHoldsMinor, insertAudit, postJournal,
  reverseTransactionInTransaction,
} from './ledger';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

type AccountRow = {
  id: string; ledgerAccountId: string; accountReference: string; customerName: string;
  currency: Currency; status: string;
};

type BookTransferRow = {
  id: string; idempotencyKey: string; requestFingerprint: string; externalReference: string;
  sourceAccountId: string; sourceAccountReference: string; sourceCustomerName: string;
  destinationAccountId: string; destinationAccountReference: string; destinationCustomerName: string;
  transactionId: string; reversalTransactionId: string | null; description: string; amountMinor: string;
  currency: Currency; status: string; riskScore: number; holdId: string | null;
  createdBy: string; reversedAt: string | null; createdAt: string; updatedAt: string;
};

export type BookTransferInput = {
  organizationId: string; actor: AuthUser; idempotencyKey: string; externalReference: string;
  sourceAccountId: string; destinationAccountId: string; description: string;
  amountMinor: bigint; currency: Currency; signals?: ProtectedRiskSignals;
  transferId?: string; approvalContext?: { requestId: string; requestedBy: string };
};

export class BookTransferError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'book_transfer_error') { super(message); }
}

const transferSelect = `SELECT bt.id, bt.idempotency_key AS "idempotencyKey", bt.request_fingerprint AS "requestFingerprint",
  bt.external_reference AS "externalReference", bt.source_account_id AS "sourceAccountId",
  source.account_reference AS "sourceAccountReference", source_customer.name AS "sourceCustomerName",
  bt.destination_account_id AS "destinationAccountId", destination.account_reference AS "destinationAccountReference",
  destination_customer.name AS "destinationCustomerName", bt.transaction_id AS "transactionId",
  bt.reversal_transaction_id AS "reversalTransactionId", bt.description, bt.amount_minor::text AS "amountMinor",
  bt.currency, bt.status, t.risk_score AS "riskScore", h.id AS "holdId", bt.created_by AS "createdBy",
  bt.reversed_at AS "reversedAt", bt.created_at AS "createdAt", bt.updated_at AS "updatedAt"
  FROM book_transfers bt
  JOIN accounts source ON source.id = bt.source_account_id
  JOIN customers source_customer ON source_customer.id = source.customer_id
  JOIN accounts destination ON destination.id = bt.destination_account_id
  JOIN customers destination_customer ON destination_customer.id = destination.customer_id
  JOIN transactions t ON t.id = bt.transaction_id
  LEFT JOIN holds h ON h.transaction_id = bt.transaction_id`;

export function serializeBookTransfer(row: BookTransferRow) {
  const { idempotencyKey, requestFingerprint, ...publicRow } = row; void idempotencyKey; void requestFingerprint;
  return { ...publicRow, amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency) };
}

export async function bookTransferFingerprint(input: Pick<BookTransferInput,
  'externalReference' | 'sourceAccountId' | 'destinationAccountId' | 'description' | 'amountMinor' | 'currency' | 'signals'>) {
  return sha256(JSON.stringify({ externalReference: input.externalReference, sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId, description: input.description,
    amountMinor: input.amountMinor.toString(), currency: input.currency, signals: input.signals ?? {} }));
}

export async function findBookTransferByIdempotency(input: BookTransferInput, database: DatabaseClient) {
  const row = await database.prepare(`${transferSelect} WHERE bt.organization_id = ? AND bt.idempotency_key = ? LIMIT 1`)
    .bind(input.organizationId, input.idempotencyKey).first<BookTransferRow>();
  if (!row) return null;
  const fingerprint = await bookTransferFingerprint(input);
  if (row.requestFingerprint !== fingerprint) {
    throw new BookTransferError('La Idempotency-Key ya fue usada con otro book transfer.', 409, 'idempotency_mismatch');
  }
  return serializeBookTransfer(row);
}

export async function createBookTransferInTransaction(input: BookTransferInput, database: DatabaseClient) {
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new BookTransferError('La cuenta de origen y destino deben ser diferentes.', 400, 'same_account');
  }
  const operationKey = `book-transfer:${input.idempotencyKey}`;
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:${operationKey}`).first();
  const existing = await findBookTransferByIdempotency(input, database);
  if (existing) return { transfer: existing, replayed: true };
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
    .bind(`${input.organizationId}:book-transfer-reference:${input.externalReference}`).first();
  const referenceOwner = await database.prepare(
    'SELECT id FROM book_transfers WHERE organization_id = ? AND external_reference = ? LIMIT 1',
  ).bind(input.organizationId, input.externalReference).first<{ id: string }>();
  if (referenceOwner) throw new BookTransferError('La referencia externa ya pertenece a otro book transfer.', 409, 'external_reference_conflict');

  const accountRows = await database.prepare(`SELECT a.id, a.ledger_account_id AS "ledgerAccountId",
      a.account_reference AS "accountReference", c.name AS "customerName", a.currency, a.status
    FROM accounts a JOIN customers c ON c.id = a.customer_id
    WHERE a.organization_id = ? AND a.id IN (?, ?) ORDER BY a.ledger_account_id FOR UPDATE OF a`)
    .bind(input.organizationId, input.sourceAccountId, input.destinationAccountId).all<AccountRow>();
  const source = accountRows.results.find((account) => account.id === input.sourceAccountId);
  const destination = accountRows.results.find((account) => account.id === input.destinationAccountId);
  if (!source || !destination) throw new BookTransferError('La cuenta de origen o destino no pertenece a la organización.', 404, 'account_not_found');
  if (source.status !== 'active' || destination.status !== 'active') {
    throw new BookTransferError('Ambas cuentas deben estar activas.', 409, 'account_inactive');
  }
  if (source.currency !== input.currency || destination.currency !== input.currency) {
    throw new BookTransferError('Ambas cuentas deben usar la moneda del book transfer.', 409, 'currency_mismatch');
  }
  const [current, held] = await Promise.all([
    accountBalanceMinor(source.ledgerAccountId, database), activeHoldsMinor(source.ledgerAccountId, database),
  ]);
  if (input.amountMinor > current - held) {
    throw new BookTransferError('Saldo disponible insuficiente en la cuenta de origen.', 422, 'insufficient_funds');
  }

  let assessment;
  try {
    assessment = await assessRisk({ organizationId: input.organizationId, idempotencyKey: operationKey,
      operationType: 'transfer', amountMinor: input.amountMinor, currency: input.currency,
      counterparty: `internal:${destination.accountReference}`, signals: input.signals }, database);
  } catch (error) {
    if (error instanceof RiskError) throw new BookTransferError(error.message, error.status, error.code);
    throw error;
  }
  if (assessment.decision === 'decline') {
    const declined = await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey,
      actor: input.actor, assessment }, database);
    return { declined, replayed: declined.replayed };
  }

  const id = input.transferId ?? crypto.randomUUID(); const transactionId = crypto.randomUUID();
  const now = new Date().toISOString(); const status = assessment.decision === 'review' ? 'review' : 'settled';
  const fingerprint = await bookTransferFingerprint(input);
  await database.prepare(`INSERT INTO transactions
    (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score,
     reversal_of, created_at, updated_at) VALUES (?, ?, ?, 'book_transfer', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .bind(transactionId, input.organizationId, operationKey, destination.accountReference, input.description,
      (-input.amountMinor).toString(), input.currency, status, assessment.score, now, now).run();
  await database.prepare(`INSERT INTO book_transfers
    (id, organization_id, idempotency_key, request_fingerprint, external_reference, source_account_id,
     destination_account_id, transaction_id, reversal_transaction_id, description, amount_minor, currency, status,
     created_by, reversed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .bind(id, input.organizationId, input.idempotencyKey, fingerprint, input.externalReference, source.id, destination.id,
      transactionId, input.description, input.amountMinor.toString(), input.currency, status,
      input.approvalContext?.requestedBy ?? input.actor.userId, now, now).run();

  let holdId: string | null = null;
  if (status === 'review') {
    holdId = crypto.randomUUID();
    await database.prepare(`INSERT INTO holds
      (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status,
       expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
      .bind(holdId, input.organizationId, source.ledgerAccountId, transactionId, operationKey,
        input.amountMinor.toString(), input.currency, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), now, now).run();
  } else {
    await postJournal({ organizationId: input.organizationId, transactionId, idempotencyKey: operationKey,
      kind: 'book_transfer', description: input.description, currency: input.currency,
      postings: [
        { accountId: source.ledgerAccountId, direction: 'debit', amountMinor: input.amountMinor },
        { accountId: destination.ledgerAccountId, direction: 'credit', amountMinor: input.amountMinor },
      ], createdAt: now }, database);
  }
  await persistRiskAssessment({ organizationId: input.organizationId, idempotencyKey: operationKey, actor: input.actor,
    assessment, resourceId: transactionId, holdId }, database);
  await insertAudit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
    action: 'book_transfer.created', resourceType: 'book_transfer', resourceId: id,
    payload: { externalReference: input.externalReference, sourceAccountId: source.id, destinationAccountId: destination.id,
      transactionId, amountMinor: input.amountMinor.toString(), currency: input.currency, status,
      riskScore: assessment.score, riskDecision: assessment.decision,
      approvalRequestId: input.approvalContext?.requestId ?? null, requestedBy: input.approvalContext?.requestedBy ?? null } });
  const created = await database.prepare(`${transferSelect} WHERE bt.organization_id = ? AND bt.id = ? LIMIT 1`)
    .bind(input.organizationId, id).first<BookTransferRow>();
  if (!created) throw new BookTransferError('No se pudo recuperar el book transfer.', 500, 'book_transfer_create_failed');
  return { transfer: serializeBookTransfer(created), replayed: false };
}

export function createBookTransfer(input: BookTransferInput) {
  return getDatabaseClient().transaction((database) => createBookTransferInTransaction(input, database));
}

export async function listBookTransfers(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (bt.created_at, bt.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${transferSelect} WHERE bt.organization_id = ? ${clause} ORDER BY bt.created_at DESC, bt.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<BookTransferRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<BookTransferRow>();
  return rows.results.map(serializeBookTransfer);
}

export async function retrieveBookTransfer(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await database.prepare(`${transferSelect} WHERE bt.organization_id = ? AND bt.id = ? LIMIT 1`)
    .bind(organizationId, id).first<BookTransferRow>();
  return row ? serializeBookTransfer(row) : null;
}

export async function reverseBookTransfer(input: {
  organizationId: string; actor: AuthUser; transferId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    const transfer = await database.prepare(`SELECT id, transaction_id AS "transactionId" FROM book_transfers
      WHERE organization_id = ? AND id = ? FOR UPDATE`)
      .bind(input.organizationId, input.transferId).first<{ id: string; transactionId: string }>();
    if (!transfer) throw new BookTransferError('Book transfer no encontrado.', 404, 'book_transfer_not_found');
    const result = await reverseTransactionInTransaction({ organizationId: input.organizationId, actor: input.actor,
      transactionId: transfer.transactionId, idempotencyKey: input.idempotencyKey,
      auditAction: 'book_transfer.reversed' }, database);
    return { transfer: await retrieveBookTransfer(input.organizationId, transfer.id, database),
      reversal: result.transaction, replayed: result.replayed };
  });
}

type StatementRow = {
  id: string; journalId: string; transactionId: string | null; kind: string; description: string;
  direction: 'debit' | 'credit'; amountMinor: string; signedAmountMinor: string; currency: Currency;
  status: string | null; reversalOf: string | null; createdAt: string;
};

export async function getAccountStatement(input: {
  organizationId: string; accountId: string; from: string; to: string; limit: number;
  cursor?: { createdAt: string; id: string };
}) {
  const database = getDatabaseClient();
  const account = await database.prepare(`SELECT a.id, a.account_reference AS "accountReference", a.currency,
      a.status, a.ledger_account_id AS "ledgerAccountId", f.normal_balance AS "normalBalance"
    FROM accounts a JOIN financial_accounts f ON f.id = a.ledger_account_id
    WHERE a.organization_id = ? AND a.id = ? LIMIT 1`)
    .bind(input.organizationId, input.accountId).first<{
      id: string; accountReference: string; currency: Currency; status: string; ledgerAccountId: string; normalBalance: 'credit' | 'debit';
    }>();
  if (!account) throw new BookTransferError('Cuenta no encontrada.', 404, 'account_not_found');
  const [opening, period] = await Promise.all([
    database.prepare(`SELECT COALESCE(SUM(CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS value
      FROM ledger_postings p JOIN financial_accounts f ON f.id = p.account_id
      WHERE p.account_id = ? AND p.created_at < ?`).bind(account.ledgerAccountId, input.from).first<{ value: string }>(),
    database.prepare(`SELECT COALESCE(SUM(CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS value
      FROM ledger_postings p JOIN financial_accounts f ON f.id = p.account_id
      WHERE p.account_id = ? AND p.created_at >= ? AND p.created_at < ?`).bind(account.ledgerAccountId, input.from, input.to).first<{ value: string }>(),
  ]);
  const cursorClause = input.cursor ? 'AND (p.created_at, p.id) < (?, ?)' : '';
  const statement = database.prepare(`SELECT p.id, p.journal_id AS "journalId", j.transaction_id AS "transactionId",
      j.kind, j.description, p.direction, p.amount_minor::text AS "amountMinor",
      (CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END)::text AS "signedAmountMinor",
      p.currency, t.status, j.reversal_of AS "reversalOf", p.created_at AS "createdAt"
    FROM ledger_postings p JOIN financial_accounts f ON f.id = p.account_id
    JOIN ledger_journals j ON j.id = p.journal_id LEFT JOIN transactions t ON t.id = j.transaction_id
    WHERE p.organization_id = ? AND p.account_id = ? AND p.created_at >= ? AND p.created_at < ? ${cursorClause}
    ORDER BY p.created_at DESC, p.id DESC LIMIT ?`);
  const rows = input.cursor
    ? await statement.bind(input.organizationId, account.ledgerAccountId, input.from, input.to,
      input.cursor.createdAt, input.cursor.id, input.limit + 1).all<StatementRow>()
    : await statement.bind(input.organizationId, account.ledgerAccountId, input.from, input.to, input.limit + 1).all<StatementRow>();
  const openingMinor = BigInt(opening?.value ?? '0'); const closingMinor = openingMinor + BigInt(period?.value ?? '0');
  return { account: { id: account.id, accountReference: account.accountReference, currency: account.currency, status: account.status },
    period: { from: input.from, to: input.to, openingBalanceMinor: openingMinor.toString(),
      openingBalance: minorToMajorNumber(openingMinor, account.currency), closingBalanceMinor: closingMinor.toString(),
      closingBalance: minorToMajorNumber(closingMinor, account.currency) },
    entries: rows.results.map((row) => ({ ...row,
      amount: minorToMajorNumber(BigInt(row.amountMinor), row.currency),
      signedAmount: minorToMajorNumber(BigInt(row.signedAmountMinor), row.currency) })) };
}
