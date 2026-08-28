import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, majorToMinor, minorToMajorNumber } from '@/app/lib/ledger/money';
import { DatabaseClient, getDatabaseClient } from './client';

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

async function insertAudit(database: DatabaseClient, input: {
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

async function postJournal(input: {
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

async function accountBalanceMinor(accountId: string, database: DatabaseClient) {
  const result = await database.prepare(
    `SELECT COALESCE(SUM(CASE WHEN p.direction = a.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS balanceMinor
     FROM financial_accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id
     WHERE a.id = ? GROUP BY a.id`,
  ).bind(accountId).first<{ balanceMinor: string }>();
  return BigInt(result?.balanceMinor ?? '0');
}

async function activeHoldsMinor(accountId: string, database: DatabaseClient) {
  const result = await database.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0)::text AS heldMinor
     FROM holds WHERE account_id = ? AND status = 'active'`,
  ).bind(accountId).first<{ heldMinor: string }>();
  return BigInt(result?.heldMinor ?? '0');
}

export async function createTransfer(input: {
  organizationId: string;
  actor: AuthUser;
  idempotencyKey: string;
  counterparty: string;
  description: string;
  amountMinor: bigint;
  currency: Currency;
  riskScore: number;
}) {
  const database = getDatabaseClient();
  return database.transaction(async (transaction) => {
    const operationKey = `transfer:${input.idempotencyKey}`;
    await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:${operationKey}`).first();
    const existing = await transaction.prepare(
      `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
        risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
       FROM transactions WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, operationKey).first<StoredTransaction>();
    if (existing) {
      if (
        existing.counterparty !== input.counterparty || existing.description !== input.description ||
        BigInt(existing.amountMinor) !== -input.amountMinor || existing.currency !== input.currency
      ) {
        throw new LedgerError('La Idempotency-Key ya fue usada con otro payload.', 409, 'idempotency_mismatch');
      }
      return { transaction: serializeTransaction(existing), replayed: true };
    }

    const accounts = await getOrCreateCoreAccounts(input.organizationId, input.currency, transaction);
    await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
      .bind(accounts.customerFunds).first();
    const current = await accountBalanceMinor(accounts.customerFunds, transaction);
    const held = await activeHoldsMinor(accounts.customerFunds, transaction);
    if (input.amountMinor > current - held) {
      throw new LedgerError('Saldo disponible insuficiente para completar la transferencia.', 422, 'insufficient_funds');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const status = input.riskScore >= 60 ? 'review' : 'settled';
    const inserted = await transaction.prepare(
      `INSERT INTO transactions
        (id, organization_id, idempotency_key, type, counterparty, description, amount_minor, currency, status, risk_score, reversal_of, created_at, updated_at)
       VALUES (?, ?, ?, 'debit', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
    ).bind(
      id, input.organizationId, operationKey, input.counterparty, input.description,
      (-input.amountMinor).toString(), input.currency, status, input.riskScore, now, now,
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

    if (status === 'review') {
      await transaction.prepare(
        `INSERT INTO holds
          (id, organization_id, account_id, transaction_id, idempotency_key, amount_minor, currency, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), input.organizationId, accounts.customerFunds, id, operationKey,
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
    await insertAudit(transaction, {
      organizationId: input.organizationId,
      actorId: input.actor.userId,
      action: 'transfer.created',
      resourceType: 'transaction',
      resourceId: id,
      payload: { amountMinor: input.amountMinor.toString(), currency: input.currency, status, riskScore: input.riskScore },
    });
    return {
      transaction: serializeTransaction({
        id, counterparty: input.counterparty, description: input.description, amountMinor: (-input.amountMinor).toString(),
        currency: input.currency, status, riskScore: input.riskScore, reversalOf: null, createdAt: now,
      }),
      replayed: false,
    };
  });
}

export async function reverseTransfer(input: {
  organizationId: string;
  actor: AuthUser;
  transactionId: string;
  idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (transaction) => {
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
    await insertAudit(transaction, {
      organizationId: input.organizationId,
      actorId: input.actor.userId,
      action: 'transfer.reversed',
      resourceType: 'transaction',
      resourceId: original.id,
      payload: { reversalId: id },
    });
    return {
      transaction: serializeTransaction({
        ...original, id, amountMinor: (-BigInt(original.amountMinor)).toString(), status: 'settled',
        riskScore: 0, reversalOf: original.id, description: `Reversa: ${original.description}`, createdAt: now,
      }),
      replayed: false,
    };
  });
}

export async function resolveHold(input: {
  organizationId: string;
  actor: AuthUser;
  holdId: string;
  action: 'capture' | 'release';
}) {
  return getDatabaseClient().transaction(async (transaction) => {
    const hold = await transaction.prepare(
      `SELECT h.id, h.account_id AS accountId, h.transaction_id AS transactionId, h.amount_minor::text AS amountMinor,
        h.currency, h.status, t.description
       FROM holds h JOIN transactions t ON t.id = h.transaction_id
       WHERE h.id = ? AND h.organization_id = ? FOR UPDATE`,
    ).bind(input.holdId, input.organizationId).first<{
      id: string; accountId: string; transactionId: string; amountMinor: string;
      currency: Currency; status: string; description: string;
    }>();
    if (!hold) throw new LedgerError('Reserva no encontrada.', 404, 'hold_not_found');
    if (hold.status !== 'active') return { id: hold.id, status: hold.status, replayed: true };
    await transaction.prepare('SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE')
      .bind(hold.accountId).first();
    const now = new Date().toISOString();
    if (input.action === 'capture') {
      const accounts = await getOrCreateCoreAccounts(input.organizationId, hold.currency, transaction);
      await postJournal({
        organizationId: input.organizationId,
        transactionId: hold.transactionId,
        idempotencyKey: `hold:capture:${hold.id}`,
        kind: 'hold_capture',
        description: hold.description,
        currency: hold.currency,
        postings: [
          { accountId: hold.accountId, direction: 'debit', amountMinor: BigInt(hold.amountMinor) },
          { accountId: accounts.settlement, direction: 'credit', amountMinor: BigInt(hold.amountMinor) },
        ],
        createdAt: now,
      }, transaction);
      await transaction.prepare("UPDATE holds SET status = 'captured', updated_at = ? WHERE id = ?").bind(now, hold.id).run();
      await transaction.prepare("UPDATE transactions SET status = 'settled', updated_at = ? WHERE id = ?").bind(now, hold.transactionId).run();
    } else {
      await transaction.prepare("UPDATE holds SET status = 'released', updated_at = ? WHERE id = ?").bind(now, hold.id).run();
      await transaction.prepare("UPDATE transactions SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, hold.transactionId).run();
    }
    await insertAudit(transaction, {
      organizationId: input.organizationId,
      actorId: input.actor.userId,
      action: `hold.${input.action === 'capture' ? 'captured' : 'released'}`,
      resourceType: 'hold',
      resourceId: hold.id,
      payload: { transactionId: hold.transactionId },
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
