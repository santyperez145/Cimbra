import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import { issueSandboxCvu, railLast4 } from '@/app/lib/platform/cbu';
import { aliasChangeBlocked } from '@/app/lib/platform/instant-payments-input';
import { assertSandboxLedgerOrCertifiedRail } from './platform-rails';
import type {
  CollectionMethod, NormalizedCollectionTillInboundInput, NormalizedCollectionTillInput, NormalizedPaymentLinkInput, NormalizedPaymentLinkPayInput,
} from '@/app/lib/platform/collections-input';
import { storedPaymentLinkItems } from '@/app/lib/platform/collections-input';
import type { ProtectedRiskSignals } from '@/app/lib/platform/risk-signals';
import { type DatabaseClient, getDatabaseClient } from './client';
import {
  accountBalanceMinor, activeHoldsMinor, createAccountPaymentInTransaction, insertAudit, LedgerError, postJournal,
  reverseTransactionInTransaction,
} from './ledger';
import { retrieveInstantTransfer } from './instant-payments';
import { assessRisk, persistRiskAssessment, RiskError } from './risk';

export class CollectionError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'collection_error') { super(message); }
}

type AccountRow = {
  id: string; ledgerAccountId: string; accountReference: string; customerName: string;
  taxIdLast4: string; currency: Currency; country: string; status: string;
};

type LinkRow = {
  id: string; accountId: string; accountReference: string; customerName: string;
  amountMinor: string; currency: Currency; description: string; externalReference: string;
  allowedMethods: string; payload: string; status: string; expiresAt: string;
  paidMethod: CollectionMethod | null; payerAccountId: string | null; payerAccountReference: string | null;
  transactionId: string | null; reversalTransactionId: string | null;
  qrDebtId: string | null; collectionTillId: string | null; qrPayload: string | null; cvu: string | null;
  collectedMinor: string; items: string;
  requestFingerprint: string; payFingerprint: string | null; createdAt: string; updatedAt: string;
};

type CreditRow = {
  id: string; paymentLinkId: string; amountMinor: string; method: CollectionMethod;
  payerAccountId: string | null; transactionId: string; instantTransferId: string | null; createdAt: string;
};

const linkSelect = `SELECT pl.id, pl.account_id AS "accountId", a.account_reference AS "accountReference",
  c.name AS "customerName", pl.amount_minor::text AS "amountMinor", pl.currency, pl.description,
  pl.external_reference AS "externalReference", pl.allowed_methods AS "allowedMethods", pl.payload, pl.status,
  pl.expires_at AS "expiresAt", pl.paid_method AS "paidMethod", pl.payer_account_id AS "payerAccountId",
  payer.account_reference AS "payerAccountReference", pl.transaction_id AS "transactionId",
  pl.reversal_transaction_id AS "reversalTransactionId", pl.qr_debt_id AS "qrDebtId",
  pl.collection_till_id AS "collectionTillId", q.payload AS "qrPayload", ct.cvu,
  pl.collected_minor::text AS "collectedMinor", pl.items,
  pl.request_fingerprint AS "requestFingerprint",
  pl.pay_fingerprint AS "payFingerprint", pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
  FROM payment_links pl JOIN accounts a ON a.id = pl.account_id JOIN customers c ON c.id = a.customer_id
  LEFT JOIN accounts payer ON payer.id = pl.payer_account_id
  LEFT JOIN qr_debts d ON d.id = pl.qr_debt_id
  LEFT JOIN payment_qrs q ON q.id = d.payment_qr_id
  LEFT JOIN collection_tills ct ON ct.id = pl.collection_till_id`;

const COLLECTION_METHOD_SET = new Set<CollectionMethod>(['internal', 'sandbox_inbound', 'cimbra_qr', 'cimbra_cvu']);

function parseMethods(value: string): CollectionMethod[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CollectionMethod =>
      typeof item === 'string' && COLLECTION_METHOD_SET.has(item as CollectionMethod)) : [];
  } catch {
    return [];
  }
}

function effectiveStatus(row: Pick<LinkRow, 'status' | 'expiresAt'>) {
  return row.status === 'open' && row.expiresAt <= new Date().toISOString() ? 'expired' : row.status;
}

function checkoutUrlFor(id: string) {
  const configured = process.env.CIMBRA_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_CIMBRA_PUBLIC_URL?.trim() || '';
  try {
    return configured ? `${new URL(configured).origin}/pay/${id}` : `/pay/${id}`;
  } catch {
    return `/pay/${id}`;
  }
}

function parseStoredItems(value: string | undefined) {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const description = typeof item.description === 'string' ? item.description : '';
      const amountMinor = typeof item.amountMinor === 'string' ? item.amountMinor : '';
      const quantity = Number(item.quantity);
      if (!description || !amountMinor || !Number.isInteger(quantity) || quantity < 1) return [];
      return [{
        description,
        amountMinor,
        amount: minorToMajorNumber(BigInt(amountMinor), 'ARS' as Currency),
        quantity,
        code: typeof item.code === 'string' ? item.code : null,
        additional: typeof item.additional === 'string' ? item.additional : null,
      }];
    });
  } catch {
    return [];
  }
}

function serializeLink(row: LinkRow, credits: CreditRow[] = []) {
  const { requestFingerprint: _fingerprint, payFingerprint: _pay, items: itemsJson, ...publicRow } = row;
  void _fingerprint; void _pay;
  const amountMinor = BigInt(row.amountMinor);
  const collectedMinor = BigInt(row.collectedMinor ?? '0');
  const remainingMinor = collectedMinor >= amountMinor ? 0n : amountMinor - collectedMinor;
  const status = effectiveStatus(row);
  return {
    ...publicRow,
    amount: minorToMajorNumber(amountMinor, row.currency),
    collectedMinor: collectedMinor.toString(),
    collectedAmount: minorToMajorNumber(collectedMinor, row.currency),
    remainingMinor: remainingMinor.toString(),
    remainingAmount: minorToMajorNumber(remainingMinor, row.currency),
    partiallyCollected: collectedMinor > 0n && remainingMinor > 0n && (status === 'open' || status === 'pending'),
    checkoutUrl: checkoutUrlFor(row.id),
    allowedMethods: parseMethods(row.allowedMethods),
    items: parseStoredItems(itemsJson),
    credits: credits.map((credit) => ({
      id: credit.id,
      amountMinor: credit.amountMinor,
      amount: minorToMajorNumber(BigInt(credit.amountMinor), row.currency),
      method: credit.method,
      payerAccountId: credit.payerAccountId,
      transactionId: credit.transactionId,
      instantTransferId: credit.instantTransferId,
      createdAt: credit.createdAt,
    })),
    status,
  };
}

async function loadCredits(database: DatabaseClient, linkIds: string[]) {
  const grouped = new Map<string, CreditRow[]>();
  if (linkIds.length === 0) return grouped;
  const rows = await database.prepare(
    `SELECT id, payment_link_id AS "paymentLinkId", amount_minor::text AS "amountMinor", method,
      payer_account_id AS "payerAccountId", transaction_id AS "transactionId",
      instant_transfer_id AS "instantTransferId", created_at AS "createdAt"
     FROM payment_link_credits WHERE payment_link_id IN (${linkIds.map(() => '?').join(', ')})
     ORDER BY created_at, id`,
  ).bind(...linkIds).all<CreditRow>();
  for (const row of rows.results) {
    const list = grouped.get(row.paymentLinkId) ?? [];
    list.push(row);
    grouped.set(row.paymentLinkId, list);
  }
  return grouped;
}

async function presentLink(row: LinkRow, database: DatabaseClient) {
  const credits = (await loadCredits(database, [row.id])).get(row.id) ?? [];
  return serializeLink(row, credits);
}

async function loadAccount(database: DatabaseClient, organizationId: string, accountId: string, lock = false) {
  return database.prepare(
    `SELECT a.id, a.ledger_account_id AS "ledgerAccountId", a.account_reference AS "accountReference",
      c.name AS "customerName", c.tax_id_last4 AS "taxIdLast4", a.currency, a.country, a.status
     FROM accounts a JOIN customers c ON c.id = a.customer_id
     WHERE a.organization_id = ? AND a.id = ? LIMIT 1 ${lock ? 'FOR UPDATE OF a' : ''}`,
  ).bind(organizationId, accountId).first<AccountRow>();
}

function assertCollector(account: AccountRow | null): asserts account is AccountRow {
  if (!account) throw new CollectionError('Cuenta no encontrada.', 404, 'account_not_found');
  if (account.status !== 'active') throw new CollectionError('La cuenta no está activa.', 409, 'account_inactive');
  if (account.currency !== 'ARS') throw new CollectionError('Las cobranzas sandbox de Argentina operan sólo en ARS.', 409, 'currency_mismatch');
  if (account.country !== 'AR') throw new CollectionError('Las cobranzas sandbox de Argentina operan sólo con cuentas argentinas.', 409, 'country_mismatch');
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

async function insertLinkInstantTransfer(database: DatabaseClient, input: {
  id: string; organizationId: string; idempotencyKey: string; fingerprint: string;
  scheme: 'credit_push' | 'qr_collect'; direction: 'internal' | 'inbound';
  sourceAccountId: string | null; destinationAccountId: string; counterpartyKind: 'cvu' | 'alias';
  counterpartyValue: string; holderName: string; taxIdLast4: string; amountMinor: bigint;
  description: string; externalReference: string; status: string; transactionId: string;
  qrPayload: string | null; collectionTillId: string | null; actorId: string; createdAt: string;
}) {
  const hash = await sha256(input.counterpartyValue);
  await database.prepare(`INSERT INTO instant_transfers
    (id, organization_id, idempotency_key, request_fingerprint, scheme, direction, source_account_id, destination_account_id,
     counterparty_kind, counterparty_hash, counterparty_last4, counterparty_holder_name, counterparty_tax_last4,
     amount_minor, currency, description, external_reference, status, rail, transaction_id, reversal_transaction_id,
     qr_payload, expires_at, collection_till_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, 'cimbra_sandbox', ?, NULL, ?, NULL, ?, ?, ?, ?)`)
    .bind(
      input.id, input.organizationId, input.idempotencyKey, input.fingerprint, input.scheme, input.direction,
      input.sourceAccountId, input.destinationAccountId, input.counterpartyKind, hash, railLast4(input.counterpartyValue),
      input.holderName, input.taxIdLast4, input.amountMinor.toString(), input.description, input.externalReference,
      input.status, input.transactionId, input.qrPayload, input.collectionTillId, input.actorId, input.createdAt, input.createdAt,
    ).run();
}

async function loadOpenQrDebt(database: DatabaseClient, organizationId: string, debtId: string) {
  const debt = await database.prepare(
    `SELECT d.id, d.account_id AS "accountId", d.amount_minor::text AS "amountMinor", d.status,
      d.expires_at AS "expiresAt", d.payment_qr_id AS "paymentQrId", q.payload, q.status AS "qrStatus"
     FROM qr_debts d JOIN payment_qrs q ON q.id = d.payment_qr_id
     WHERE d.organization_id = ? AND d.id = ? LIMIT 1 FOR UPDATE OF d`,
  ).bind(organizationId, debtId).first<{
    id: string; accountId: string; amountMinor: string; status: string; expiresAt: string;
    paymentQrId: string; payload: string; qrStatus: string;
  }>();
  if (!debt) throw new CollectionError('Deuda QR no encontrada.', 404, 'qr_debt_not_found');
  const now = new Date().toISOString();
  if (debt.status === 'open' && debt.expiresAt <= now) {
    await database.prepare("UPDATE qr_debts SET status = 'expired', updated_at = ? WHERE id = ?").bind(now, debt.id).run();
    await database.prepare("UPDATE payment_qrs SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(now, debt.paymentQrId).run();
    throw new CollectionError('La deuda QR expiró.', 409, 'qr_debt_expired');
  }
  if (debt.status !== 'open') throw new CollectionError('La deuda QR no está abierta.', 409, 'qr_debt_not_open');
  return debt;
}

export async function listPaymentLinks(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (pl.created_at, pl.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${linkSelect} WHERE pl.organization_id = ? ${clause} ORDER BY pl.created_at DESC, pl.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<LinkRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<LinkRow>();
  const creditsByLink = await loadCredits(getDatabaseClient(), rows.results.map((row) => row.id));
  return rows.results.map((row) => serializeLink(row, creditsByLink.get(row.id) ?? []));
}

export async function retrievePaymentLink(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await retrieveLinkRow(organizationId, id, database);
  return row ? presentLink(row, database) : null;
}

export async function retrievePublicPaymentLink(id: string) {
  const database = getDatabaseClient();
  const row = await database.prepare(`${linkSelect} WHERE pl.id = ? LIMIT 1`).bind(id).first<LinkRow>();
  if (!row) return null;
  return presentLink(await expireIfNeeded(database, row), database);
}

export async function createPaymentLink(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; link: NormalizedPaymentLinkInput;
}) {
  const { qrDebtId, collectionTillId, items, amountMinor, ...rest } = input.link;
  const fingerprint = await sha256(JSON.stringify({
    ...rest, amountMinor: amountMinor.toString(),
    ...(items.length ? {
      items: items.map((item) => ({
        description: item.description, amountMinor: item.amountMinor.toString(),
        quantity: item.quantity, code: item.code, additional: item.additional,
      })),
    } : {}),
    ...(qrDebtId ? { qrDebtId } : {}),
    ...(collectionTillId ? { collectionTillId } : {}),
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
      return { link: await presentLink(existing, database), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-ref:${input.link.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM payment_links WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.link.externalReference).first<{ id: string }>();
    if (referenceOwner) throw new CollectionError('La referencia externa ya pertenece a otro link de cobro.', 409, 'external_reference_conflict');
    const account = await loadAccount(database, input.organizationId, input.link.accountId, true);
    assertCollector(account);
    if (input.link.qrDebtId) {
      await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
        .bind(`${input.organizationId}:payment-link-debt:${input.link.qrDebtId}`).first();
      const debt = await loadOpenQrDebt(database, input.organizationId, input.link.qrDebtId);
      if (debt.accountId !== account.id) {
        throw new CollectionError('La deuda QR pertenece a otra cuenta.', 422, 'qr_debt_account_mismatch');
      }
      if (BigInt(debt.amountMinor) !== input.link.amountMinor) {
        throw new CollectionError('El monto del link debe coincidir con la deuda QR.', 422, 'qr_debt_amount_mismatch');
      }
      const linked = await database.prepare('SELECT id FROM payment_links WHERE qr_debt_id = ? LIMIT 1')
        .bind(debt.id).first<{ id: string }>();
      if (linked) throw new CollectionError('La deuda QR ya tiene un link de cobro.', 409, 'qr_debt_link_conflict');
    }
    if (input.link.collectionTillId) {
      const till = await database.prepare(
        `SELECT id, account_id AS "accountId", status FROM collection_tills
         WHERE organization_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
      ).bind(input.organizationId, input.link.collectionTillId).first<{ id: string; accountId: string; status: string }>();
      if (!till) throw new CollectionError('Punto de recaudación no encontrado.', 404, 'collection_till_not_found');
      if (till.status !== 'active') throw new CollectionError('El punto de recaudación no está activo.', 409, 'collection_till_disabled');
      if (till.accountId !== account.id) {
        throw new CollectionError('El punto de recaudación pertenece a otra cuenta.', 422, 'till_account_mismatch');
      }
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + input.link.expiresInMinutes * 60_000).toISOString();
    const payload = `cimbra:link:v1:${id}`;
    await database.prepare(`INSERT INTO payment_links
      (id, organization_id, idempotency_key, request_fingerprint, account_id, amount_minor, currency, description,
       external_reference, allowed_methods, payload, status, expires_at, paid_method, payer_account_id, transaction_id,
       reversal_transaction_id, qr_debt_id, collection_till_id, collected_minor, items, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?, 'open', ?, NULL, NULL, NULL, NULL, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, account.id, input.link.amountMinor.toString(),
        input.link.description, input.link.externalReference, JSON.stringify(input.link.methods), payload, expiresAt,
        input.link.qrDebtId, input.link.collectionTillId, storedPaymentLinkItems(input.link.items),
        input.actor.userId, createdAt, createdAt).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_created',
      resourceType: 'payment_link', resourceId: id,
      payload: {
        accountId: account.id, amountMinor: input.link.amountMinor.toString(), methods: input.link.methods, expiresAt,
        qrDebtId: input.link.qrDebtId, collectionTillId: input.link.collectionTillId,
      },
    });
    return { link: await presentLink((await retrieveLinkRow(input.organizationId, id, database))!, database), replayed: false };
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
    if (current.status === 'cancelled') return { link: await presentLink(current, database), replayed: true };
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
    return { link: await presentLink({ ...current, status: 'cancelled', updatedAt: now }, database), replayed: false };
  });
}

export async function payPaymentLink(input: {
  organizationId: string; actor: AuthUser; linkId: string; idempotencyKey: string;
  payment: NormalizedPaymentLinkPayInput; signals?: ProtectedRiskSignals;
}) {
  const fingerprint = await sha256(JSON.stringify({
    method: input.payment.method,
    payerAccountId: input.payment.payerAccountId,
    amountMinor: input.payment.amountMinor?.toString() ?? null,
    signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payment-link-pay:${input.linkId}`).first();
    const debtPointer = await database.prepare(
      'SELECT qr_debt_id AS "qrDebtId" FROM payment_links WHERE organization_id = ? AND id = ? LIMIT 1',
    ).bind(input.organizationId, input.linkId).first<{ qrDebtId: string | null }>();
    if (debtPointer?.qrDebtId) {
      await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
        .bind(`${input.organizationId}:debt-settle:${debtPointer.qrDebtId}`).first();
    }
    const row = await database.prepare(`${linkSelect} WHERE pl.organization_id = ? AND pl.id = ? LIMIT 1 FOR UPDATE OF pl`)
      .bind(input.organizationId, input.linkId).first<LinkRow>();
    if (!row) throw new CollectionError('Link de cobro no encontrado.', 404, 'payment_link_not_found');
    const current = await expireIfNeeded(database, row);
    if (input.payment.method === 'cimbra_cvu') {
      const existingCredit = await database.prepare(
        `SELECT request_fingerprint AS "requestFingerprint", payment_link_id AS "paymentLinkId"
         FROM payment_link_credits WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
      ).bind(input.organizationId, input.idempotencyKey).first<{ requestFingerprint: string; paymentLinkId: string }>();
      if (existingCredit) {
        if (existingCredit.requestFingerprint !== fingerprint || existingCredit.paymentLinkId !== current.id) {
          throw new CollectionError('La Idempotency-Key ya fue usada con otro cobro.', 409, 'idempotency_mismatch');
        }
        return { link: await presentLink((await retrieveLinkRow(input.organizationId, current.id, database))!, database), replayed: true };
      }
    } else if (current.payFingerprint === fingerprint && (current.status === 'paid' || current.status === 'pending')) {
      return { link: await presentLink(current, database), replayed: true };
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
    if (input.payment.method !== 'internal') {
      await assertSandboxLedgerOrCertifiedRail('collections', CollectionError);
    }
    const merchant = await loadAccount(database, input.organizationId, current.accountId, true);
    assertCollector(merchant);
    const now = new Date().toISOString();
    if (input.payment.method === 'internal' || input.payment.method === 'cimbra_qr') {
      if (!input.payment.payerAccountId) throw new CollectionError('El cobro interno exige cuenta pagadora.', 400, 'payer_required');
      if (input.payment.payerAccountId === merchant.id) {
        throw new CollectionError('La cuenta pagadora debe ser distinta a la del comercio.', 422, 'same_account');
      }
      const payer = await loadAccount(database, input.organizationId, input.payment.payerAccountId, true);
      assertCollector(payer);
      let debt: Awaited<ReturnType<typeof loadOpenQrDebt>> | null = null;
      if (input.payment.method === 'cimbra_qr') {
        if (!current.qrDebtId) throw new CollectionError('Este link no está asociado a una deuda QR.', 422, 'qr_debt_required');
        debt = await loadOpenQrDebt(database, input.organizationId, current.qrDebtId);
        if (debt.accountId !== merchant.id) {
          throw new CollectionError('La deuda QR pertenece a otra cuenta.', 422, 'qr_debt_account_mismatch');
        }
        if (BigInt(debt.amountMinor) !== BigInt(current.amountMinor)) {
          throw new CollectionError('El monto del link no coincide con la deuda QR.', 422, 'qr_debt_amount_mismatch');
        }
      }
      const movement = await postInternalCollection(database, {
        organizationId: input.organizationId, actor: input.actor, operationKey: `collection-pay:${input.idempotencyKey}`,
        source: payer, destination: merchant, amountMinor: BigInt(current.amountMinor), description: current.description,
        counterparty: `link:${current.payload}`, signals: input.signals,
      });
      if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
      const transferId = crypto.randomUUID();
      if (input.payment.method === 'cimbra_qr' && debt) {
        await insertLinkInstantTransfer(database, {
          id: transferId, organizationId: input.organizationId, idempotencyKey: `link-qr:${input.idempotencyKey}`,
          fingerprint, scheme: 'qr_collect', direction: 'internal', sourceAccountId: payer.id, destinationAccountId: merchant.id,
          counterpartyKind: 'alias', counterpartyValue: debt.payload.replace(/[^A-Z0-9]/gi, '').slice(0, 20).padEnd(6, 'X'),
          holderName: merchant.customerName, taxIdLast4: merchant.taxIdLast4, amountMinor: BigInt(current.amountMinor),
          description: current.description, externalReference: `link-qr:${current.id}`,
          status: movement.status === 'pending' ? 'pending' : 'settled', transactionId: movement.transactionId,
          qrPayload: debt.payload, collectionTillId: null, actorId: input.actor.userId, createdAt: now,
        });
        if (movement.status === 'paid') {
          await database.prepare("UPDATE payment_qrs SET status = 'paid', paid_transfer_id = ?, updated_at = ? WHERE id = ?")
            .bind(transferId, now, debt.paymentQrId).run();
          await database.prepare("UPDATE qr_debts SET status = 'paid', paid_transfer_id = ?, updated_at = ? WHERE id = ?")
            .bind(transferId, now, debt.id).run();
          await insertAudit(database, {
            organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.debt_paid',
            resourceType: 'qr_debt', resourceId: debt.id,
            payload: { transferId, paymentQrId: debt.paymentQrId, amountMinor: current.amountMinor, paymentLinkId: current.id },
          });
        }
      }
      const collected = movement.status === 'paid' ? current.amountMinor : '0';
      await database.prepare(`UPDATE payment_links SET status = ?, paid_method = ?, payer_account_id = ?,
        transaction_id = ?, pay_idempotency_key = ?, pay_fingerprint = ?, collected_minor = ?, updated_at = ? WHERE id = ?`)
        .bind(movement.status, input.payment.method, payer.id, movement.transactionId, input.idempotencyKey, fingerprint, collected, now, current.id).run();
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_paid',
        resourceType: 'payment_link', resourceId: current.id,
        payload: { method: input.payment.method, status: movement.status, transactionId: movement.transactionId },
      });
      return { link: await presentLink((await retrieveLinkRow(input.organizationId, current.id, database))!, database), replayed: false };
    }
    if (input.payment.method === 'cimbra_cvu') {
      if (!current.collectionTillId) {
        throw new CollectionError('Este link no está asociado a un punto de recaudación.', 422, 'collection_till_required');
      }
      const till = await database.prepare(
        `SELECT id, cvu, status FROM collection_tills WHERE organization_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
      ).bind(input.organizationId, current.collectionTillId).first<{ id: string; cvu: string; status: string }>();
      if (!till) throw new CollectionError('Punto de recaudación no encontrado.', 404, 'collection_till_not_found');
      if (till.status !== 'active') throw new CollectionError('El punto de recaudación no está activo.', 409, 'collection_till_disabled');
      const amountMinor = BigInt(current.amountMinor);
      const collectedMinor = BigInt(current.collectedMinor ?? '0');
      const remainingMinor = collectedMinor >= amountMinor ? 0n : amountMinor - collectedMinor;
      if (remainingMinor <= 0n) throw new CollectionError('El link ya fue cobrado.', 409, 'payment_link_already_paid');
      const creditAmount = input.payment.amountMinor ?? remainingMinor;
      if (creditAmount <= 0n) throw new CollectionError('El importe del crédito debe ser positivo.', 400, 'invalid_credit_amount');
      let transactionId: string;
      let movementStatus: 'pending' | 'paid';
      if (input.payment.payerAccountId) {
        if (input.payment.payerAccountId === merchant.id) {
          throw new CollectionError('La cuenta pagadora debe ser distinta a la del comercio.', 422, 'same_account');
        }
        const payer = await loadAccount(database, input.organizationId, input.payment.payerAccountId, true);
        assertCollector(payer);
        const movement = await postInternalCollection(database, {
          organizationId: input.organizationId, actor: input.actor, operationKey: `collection-pay:${input.idempotencyKey}`,
          source: payer, destination: merchant, amountMinor: creditAmount, description: current.description,
          counterparty: `link:${current.payload}`, signals: input.signals,
        });
        if ('declined' in movement) return { declined: movement.declined, replayed: movement.replayed };
        transactionId = movement.transactionId;
        movementStatus = movement.status === 'pending' ? 'pending' : 'paid';
      } else {
        let payment;
        try {
          payment = await createAccountPaymentInTransaction({
            organizationId: input.organizationId, actor: input.actor, idempotencyKey: `collection-in-${input.idempotencyKey}`,
            accountId: merchant.id, direction: 'cash_in', counterparty: `till:${railLast4(till.cvu)}`,
            description: current.description, amountMinor: creditAmount, currency: 'ARS', signals: input.signals,
          }, database);
        } catch (error) {
          if (error instanceof LedgerError) throw new CollectionError(error.message, error.status, error.code);
          throw error;
        }
        if ('declined' in payment) return { declined: payment.declined, replayed: payment.replayed };
        transactionId = payment.payment.id;
        movementStatus = payment.payment.status === 'review' ? 'pending' : 'paid';
      }
      const transferId = crypto.randomUUID();
      const creditId = crypto.randomUUID();
      await insertLinkInstantTransfer(database, {
        id: transferId, organizationId: input.organizationId, idempotencyKey: `link-cvu:${input.idempotencyKey}`,
        fingerprint, scheme: 'credit_push', direction: input.payment.payerAccountId ? 'internal' : 'inbound',
        sourceAccountId: input.payment.payerAccountId, destinationAccountId: merchant.id,
        counterpartyKind: 'cvu', counterpartyValue: till.cvu, holderName: merchant.customerName, taxIdLast4: merchant.taxIdLast4,
        amountMinor: creditAmount, description: current.description, externalReference: `link-cvu:${current.id}:${input.idempotencyKey}`,
        status: movementStatus === 'pending' ? 'pending' : 'settled', transactionId,
        qrPayload: null, collectionTillId: till.id, actorId: input.actor.userId, createdAt: now,
      });
      await database.prepare(`INSERT INTO payment_link_credits
        (id, organization_id, payment_link_id, idempotency_key, request_fingerprint, amount_minor, method,
         payer_account_id, transaction_id, instant_transfer_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'cimbra_cvu', ?, ?, ?, ?, ?)`)
        .bind(creditId, input.organizationId, current.id, input.idempotencyKey, fingerprint, creditAmount.toString(),
          input.payment.payerAccountId, transactionId, transferId, input.actor.userId, now).run();
      const settledCollected = movementStatus === 'paid' ? collectedMinor + creditAmount : collectedMinor;
      const completes = movementStatus === 'paid' && settledCollected >= amountMinor;
      const linkStatus = movementStatus === 'pending' && collectedMinor + creditAmount >= amountMinor ? 'pending'
        : completes ? 'paid' : 'open';
      if (completes) {
        await database.prepare(`UPDATE payment_links SET status = 'paid', paid_method = 'cimbra_cvu',
          payer_account_id = COALESCE(?, payer_account_id), transaction_id = ?, collected_minor = ?, updated_at = ? WHERE id = ?`)
          .bind(input.payment.payerAccountId, transactionId, settledCollected.toString(), now, current.id).run();
      } else {
        await database.prepare(`UPDATE payment_links SET status = ?, collected_minor = ?, updated_at = ? WHERE id = ?`)
          .bind(linkStatus, settledCollected.toString(), now, current.id).run();
      }
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.till_credited',
        resourceType: 'collection_till', resourceId: till.id,
        payload: { transferId, amountMinor: creditAmount.toString(), direction: input.payment.payerAccountId ? 'internal' : 'inbound', paymentLinkId: current.id },
      });
      await insertAudit(database, {
        organizationId: input.organizationId, actorId: input.actor.userId,
        action: completes ? 'collection.link_paid' : 'collection.link_credited',
        resourceType: 'payment_link', resourceId: current.id,
        payload: { method: 'cimbra_cvu', status: linkStatus, transactionId, creditId, amountMinor: creditAmount.toString(), collectedMinor: settledCollected.toString() },
      });
      return { link: await presentLink((await retrieveLinkRow(input.organizationId, current.id, database))!, database), replayed: false };
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
      transaction_id = ?, pay_idempotency_key = ?, pay_fingerprint = ?, collected_minor = ?, updated_at = ? WHERE id = ?`)
      .bind(status, payment.payment.id, input.idempotencyKey, fingerprint, status === 'paid' ? current.amountMinor : '0', now, current.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.link_paid',
      resourceType: 'payment_link', resourceId: current.id,
      payload: { method: 'sandbox_inbound', status, transactionId: payment.payment.id },
    });
    return { link: await presentLink((await retrieveLinkRow(input.organizationId, current.id, database))!, database), replayed: false };
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
          return { link: await presentLink((await retrieveLinkRow(input.organizationId, row.id, database))!, database), replayed: true };
        }
        throw new CollectionError('El cobro ya fue devuelto.', 409, 'payment_link_already_refunded');
      }
      throw new CollectionError('Sólo se puede devolver un cobro liquidado.', 409, 'payment_link_not_paid');
    }
    const credits = await database.prepare(
      `SELECT id, transaction_id AS "transactionId" FROM payment_link_credits
       WHERE organization_id = ? AND payment_link_id = ? ORDER BY created_at, id`,
    ).bind(input.organizationId, row.id).all<{ id: string; transactionId: string }>();
    let reversal;
    try {
      if (credits.results.length > 0) {
        const others = credits.results.filter((credit) => credit.transactionId !== row.transactionId);
        for (const credit of others) {
          reversal = await reverseTransactionInTransaction({
            organizationId: input.organizationId, actor: input.actor, transactionId: credit.transactionId,
            idempotencyKey: `${input.idempotencyKey}:${credit.id}`, auditAction: 'collection.refunded',
          }, database);
        }
      }
      reversal = await reverseTransactionInTransaction({
        organizationId: input.organizationId, actor: input.actor, transactionId: row.transactionId,
        idempotencyKey: input.idempotencyKey, auditAction: 'collection.refunded',
      }, database);
    } catch (error) {
      if (error instanceof LedgerError) throw new CollectionError(error.message, error.status, error.code);
      throw error;
    }
    return {
      link: await presentLink((await retrieveLinkRow(input.organizationId, row.id, database))!, database),
      reversal: reversal.transaction, replayed: reversal.replayed,
    };
  });
}

type TillRow = {
  id: string; accountId: string; accountReference: string; customerName: string; taxIdLast4: string;
  name: string; externalReference: string; cvu: string; alias: string | null; aliasChangedAt: string | null;
  paymentQrId: string | null; status: string; requestFingerprint: string; createdAt: string; updatedAt: string;
};

const tillSelect = `SELECT ct.id, ct.account_id AS "accountId", a.account_reference AS "accountReference",
  c.name AS "customerName", c.tax_id_last4 AS "taxIdLast4", ct.name, ct.external_reference AS "externalReference",
  ct.cvu, ct.alias, ct.alias_changed_at AS "aliasChangedAt", ct.payment_qr_id AS "paymentQrId", ct.status,
  ct.request_fingerprint AS "requestFingerprint", ct.created_at AS "createdAt", ct.updated_at AS "updatedAt"
  FROM collection_tills ct JOIN accounts a ON a.id = ct.account_id JOIN customers c ON c.id = a.customer_id`;

function serializeTill(row: TillRow) {
  const { requestFingerprint: _fingerprint, taxIdLast4: _tax, ...publicRow } = row;
  void _fingerprint; void _tax;
  return publicRow;
}

async function retrieveTillRow(organizationId: string, id: string, database: DatabaseClient) {
  return database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.id = ? LIMIT 1`)
    .bind(organizationId, id).first<TillRow>();
}

async function aliasTaken(database: DatabaseClient, organizationId: string, alias: string, exceptTillId?: string) {
  const instrument = await database.prepare(
    "SELECT id FROM rail_instruments WHERE organization_id = ? AND value = ? LIMIT 1",
  ).bind(organizationId, alias).first<{ id: string }>();
  if (instrument) return true;
  const till = exceptTillId
    ? await database.prepare(
      'SELECT id FROM collection_tills WHERE organization_id = ? AND alias = ? AND id <> ? LIMIT 1',
    ).bind(organizationId, alias, exceptTillId).first<{ id: string }>()
    : await database.prepare(
      'SELECT id FROM collection_tills WHERE organization_id = ? AND alias = ? LIMIT 1',
    ).bind(organizationId, alias).first<{ id: string }>();
  return Boolean(till);
}

export async function listCollectionTills(input: { organizationId: string; limit: number; cursor?: { createdAt: string; id: string } }) {
  const clause = input.cursor ? 'AND (ct.created_at, ct.id) < (?, ?)' : '';
  const statement = getDatabaseClient().prepare(
    `${tillSelect} WHERE ct.organization_id = ? ${clause} ORDER BY ct.created_at DESC, ct.id DESC LIMIT ?`,
  );
  const rows = input.cursor
    ? await statement.bind(input.organizationId, input.cursor.createdAt, input.cursor.id, input.limit + 1).all<TillRow>()
    : await statement.bind(input.organizationId, input.limit + 1).all<TillRow>();
  return rows.results.map(serializeTill);
}

export async function retrieveCollectionTill(organizationId: string, id: string, database = getDatabaseClient()) {
  const row = await retrieveTillRow(organizationId, id, database);
  return row ? serializeTill(row) : null;
}

export async function createCollectionTill(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; till: NormalizedCollectionTillInput;
}) {
  await assertSandboxLedgerOrCertifiedRail('collections', CollectionError);
  const fingerprint = await sha256(JSON.stringify(input.till));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:collection-till:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<TillRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new CollectionError('La Idempotency-Key ya fue usada con otro punto de recaudación.', 409, 'idempotency_mismatch');
      }
      return { till: serializeTill(existing), replayed: true };
    }
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:collection-till-ref:${input.till.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM collection_tills WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.till.externalReference).first<{ id: string }>();
    if (referenceOwner) {
      throw new CollectionError('La referencia externa ya pertenece a otro punto de recaudación.', 409, 'external_reference_conflict');
    }
    const account = await loadAccount(database, input.organizationId, input.till.accountId, true);
    assertCollector(account);
    if (input.till.paymentQrId) {
      const qr = await database.prepare(
        `SELECT id FROM payment_qrs WHERE organization_id = ? AND id = ? AND account_id = ? AND kind = 'static' AND status = 'active' LIMIT 1`,
      ).bind(input.organizationId, input.till.paymentQrId, account.id).first<{ id: string }>();
      if (!qr) throw new CollectionError('El QR estático debe estar activo y pertenecer a la misma cuenta cobradora.', 422, 'invalid_static_qr');
      const takenQr = await database.prepare(
        'SELECT id FROM collection_tills WHERE organization_id = ? AND payment_qr_id = ? LIMIT 1',
      ).bind(input.organizationId, input.till.paymentQrId).first<{ id: string }>();
      if (takenQr) throw new CollectionError('Ese QR estático ya está asociado a otro punto de recaudación.', 409, 'payment_qr_in_use');
    }
    if (input.till.alias && await aliasTaken(database, input.organizationId, input.till.alias)) {
      throw new CollectionError('El alias ya está asignado en este tenant.', 409, 'alias_conflict');
    }
    const id = crypto.randomUUID();
    const cvu = issueSandboxCvu(account.id, id);
    const createdAt = new Date().toISOString();
    await database.prepare(`INSERT INTO collection_tills
      (id, organization_id, idempotency_key, request_fingerprint, account_id, payment_qr_id, name, external_reference,
       cvu, alias, alias_changed_at, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, account.id, input.till.paymentQrId,
        input.till.name, input.till.externalReference, cvu, input.till.alias, input.actor.userId, createdAt, createdAt).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.till_created',
      resourceType: 'collection_till', resourceId: id,
      payload: { accountId: account.id, cvuLast4: railLast4(cvu), paymentQrId: input.till.paymentQrId },
    });
    return { till: serializeTill((await retrieveTillRow(input.organizationId, id, database))!), replayed: false };
  });
}

export async function assignCollectionTillAlias(input: {
  organizationId: string; actor: AuthUser; tillId: string; idempotencyKey: string; alias: string;
}) {
  await assertSandboxLedgerOrCertifiedRail('collections', CollectionError);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:collection-till-alias:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.assign_idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<TillRow>();
    if (replay) {
      if (replay.alias !== input.alias) {
        throw new CollectionError('La Idempotency-Key ya fue usada con otro alias.', 409, 'idempotency_mismatch');
      }
      return { till: serializeTill(replay), replayed: true };
    }
    const row = await database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.id = ? LIMIT 1 FOR UPDATE OF ct`)
      .bind(input.organizationId, input.tillId).first<TillRow>();
    if (!row) throw new CollectionError('Punto de recaudación no encontrado.', 404, 'collection_till_not_found');
    if (row.status !== 'active') throw new CollectionError('El punto de recaudación no está activo.', 409, 'collection_till_disabled');
    if (row.alias === input.alias) return { till: serializeTill(row), replayed: false };
    if (row.alias && aliasChangeBlocked(row.aliasChangedAt)) {
      throw new CollectionError('El alias no puede modificarse más de una vez en 24 horas.', 422, 'alias_change_rate_limited');
    }
    if (await aliasTaken(database, input.organizationId, input.alias, row.id)) {
      throw new CollectionError('El alias ya está asignado en este tenant.', 422, 'alias_conflict');
    }
    const now = new Date().toISOString();
    const changing = Boolean(row.alias) && row.alias !== input.alias;
    await database.prepare(`UPDATE collection_tills
      SET alias = ?, assign_idempotency_key = ?, alias_changed_at = ?, updated_at = ?
      WHERE id = ?`)
      .bind(input.alias, input.idempotencyKey, changing ? now : null, now, row.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.till_alias_assigned',
      resourceType: 'collection_till', resourceId: row.id,
      payload: { aliasLast4: railLast4(input.alias), previousLast4: row.alias ? railLast4(row.alias) : null },
    });
    return { till: serializeTill({ ...row, alias: input.alias, aliasChangedAt: changing ? now : null, updatedAt: now }), replayed: false };
  });
}

export async function disableCollectionTill(input: {
  organizationId: string; actor: AuthUser; tillId: string; idempotencyKey: string;
}) {
  await assertSandboxLedgerOrCertifiedRail('collections', CollectionError);
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:collection-till-disable:${input.tillId}`).first();
    const row = await database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.id = ? LIMIT 1 FOR UPDATE OF ct`)
      .bind(input.organizationId, input.tillId).first<TillRow>();
    if (!row) throw new CollectionError('Punto de recaudación no encontrado.', 404, 'collection_till_not_found');
    if (row.status === 'disabled') return { till: serializeTill(row), replayed: true };
    const now = new Date().toISOString();
    await database.prepare(
      "UPDATE collection_tills SET status = 'disabled', cancel_idempotency_key = ?, updated_at = ? WHERE id = ?",
    ).bind(input.idempotencyKey, now, row.id).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.till_disabled',
      resourceType: 'collection_till', resourceId: row.id, payload: { cvuLast4: railLast4(row.cvu) },
    });
    return { till: serializeTill({ ...row, status: 'disabled', updatedAt: now }), replayed: false };
  });
}

export async function creditCollectionTill(input: {
  organizationId: string; actor: AuthUser; tillId: string; idempotencyKey: string;
  inbound: NormalizedCollectionTillInboundInput; signals?: ProtectedRiskSignals;
}) {
  await assertSandboxLedgerOrCertifiedRail('collections', CollectionError);
  const fingerprint = await sha256(JSON.stringify({
    tillId: input.tillId, ...input.inbound, amountMinor: input.inbound.amountMinor.toString(), signals: input.signals ?? {},
  }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:collection-till-inbound:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      'SELECT id FROM instant_transfers WHERE organization_id = ? AND idempotency_key = ? LIMIT 1',
    ).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
    if (existing) {
      const stored = await database.prepare(
        'SELECT request_fingerprint AS "requestFingerprint", collection_till_id AS "collectionTillId" FROM instant_transfers WHERE id = ? LIMIT 1',
      ).bind(existing.id).first<{ requestFingerprint: string; collectionTillId: string | null }>();
      if (!stored || stored.requestFingerprint !== fingerprint || stored.collectionTillId !== input.tillId) {
        throw new CollectionError('La Idempotency-Key ya fue usada con otro inbound de recaudación.', 409, 'idempotency_mismatch');
      }
      const row = await retrieveTillRow(input.organizationId, input.tillId, database);
      const transfer = await retrieveInstantTransfer(input.organizationId, existing.id, database);
      if (!row || !transfer) {
        throw new CollectionError('La Idempotency-Key ya fue usada con otro inbound de recaudación.', 409, 'idempotency_mismatch');
      }
      return { till: serializeTill(row), transfer, replayed: true };
    }
    const row = await database.prepare(`${tillSelect} WHERE ct.organization_id = ? AND ct.id = ? LIMIT 1 FOR UPDATE OF ct`)
      .bind(input.organizationId, input.tillId).first<TillRow>();
    if (!row) throw new CollectionError('Punto de recaudación no encontrado.', 404, 'collection_till_not_found');
    if (row.status !== 'active') throw new CollectionError('El punto de recaudación no está activo.', 409, 'collection_till_disabled');
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:instant-ref:${input.inbound.externalReference}`).first();
    const referenceOwner = await database.prepare(
      'SELECT id FROM instant_transfers WHERE organization_id = ? AND external_reference = ? LIMIT 1',
    ).bind(input.organizationId, input.inbound.externalReference).first<{ id: string }>();
    if (referenceOwner) {
      throw new CollectionError('La referencia externa ya pertenece a otra transferencia instantánea.', 409, 'external_reference_conflict');
    }
    const merchant = await loadAccount(database, input.organizationId, row.accountId, true);
    assertCollector(merchant);
    let payment;
    try {
      payment = await createAccountPaymentInTransaction({
        organizationId: input.organizationId, actor: input.actor, idempotencyKey: `till-in-${input.idempotencyKey}`,
        accountId: merchant.id, direction: 'cash_in', counterparty: `till:${railLast4(row.cvu)}`,
        description: input.inbound.description, amountMinor: input.inbound.amountMinor, currency: 'ARS', signals: input.signals,
      }, database);
    } catch (error) {
      if (error instanceof LedgerError) throw new CollectionError(error.message, error.status, error.code);
      throw error;
    }
    if ('declined' in payment) return { declined: payment.declined, replayed: payment.replayed };
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const hash = await sha256(row.cvu);
    await database.prepare(`INSERT INTO instant_transfers
      (id, organization_id, idempotency_key, request_fingerprint, scheme, direction, source_account_id, destination_account_id,
       counterparty_kind, counterparty_hash, counterparty_last4, counterparty_holder_name, counterparty_tax_last4,
       amount_minor, currency, description, external_reference, status, rail, transaction_id, reversal_transaction_id,
       qr_payload, expires_at, collection_till_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'credit_push', 'inbound', NULL, ?, 'cvu', ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, 'cimbra_sandbox', ?, NULL, NULL, NULL, ?, ?, ?, ?)`)
      .bind(
        id, input.organizationId, input.idempotencyKey, fingerprint, merchant.id, hash, railLast4(row.cvu),
        merchant.customerName, merchant.taxIdLast4, input.inbound.amountMinor.toString(), input.inbound.description,
        input.inbound.externalReference, payment.payment.status === 'review' ? 'pending' : 'settled', payment.payment.id,
        row.id, input.actor.userId, createdAt, createdAt,
      ).run();
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'collection.till_credited',
      resourceType: 'collection_till', resourceId: row.id,
      payload: { transferId: id, amountMinor: input.inbound.amountMinor.toString(), direction: 'inbound' },
    });
    await insertAudit(database, {
      organizationId: input.organizationId, actorId: input.actor.userId, action: 'instant.transfer_created',
      resourceType: 'instant_transfer', resourceId: id,
      payload: { scheme: 'credit_push', direction: 'inbound', collectionTillId: row.id, amountMinor: input.inbound.amountMinor.toString() },
    });
    return {
      till: serializeTill(row),
      transfer: await retrieveInstantTransfer(input.organizationId, id, database),
      replayed: false,
    };
  });
}

