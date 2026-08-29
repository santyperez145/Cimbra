import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import type { Currency } from '@/app/lib/ledger/money';
import { minorToMajorNumber } from '@/app/lib/ledger/money';
import {
  disputeNextStatus, disputePossibleEvents, isOpenDispute,
  type DisputeEvent, type DisputeReason, type DisputeStatus,
} from '@/app/lib/platform/disputes';
import { type DatabaseClient, getDatabaseClient } from './client';
import { postDisputeCreditInTransaction, reverseDisputeCreditInTransaction } from './ledger';
import { enqueueWebhookEvent } from './platform';

export class DisputeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'dispute_error') { super(message); }
}

type DisputeRow = {
  id: string; transactionId: string; idempotencyKey: string; requestFingerprint: string;
  reason: DisputeReason; description: string; amountMinor: string; currency: Currency; status: DisputeStatus;
  priority: 'low' | 'medium' | 'high' | 'critical'; provisionalCreditRequested: number;
  creditAccountId: string;
  creditStatus: 'none' | 'posted' | 'final' | 'reversed'; creditTransactionId: string | null;
  creditReversalTransactionId: string | null; assignedTo: string | null; assigneeName: string | null;
  dueAt: string | null; escalatedAt: string | null; openedBy: string; openedByName: string;
  resolvedBy: string | null; resolvedByName: string | null; resolutionNote: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string; originalCounterparty: string; originalDescription: string;
  originalAmountMinor: string; originalStatus: string; originalCreatedAt: string;
};

const disputeSelect = `SELECT d.id, d.transaction_id AS "transactionId", d.idempotency_key AS "idempotencyKey",
  d.request_fingerprint AS "requestFingerprint", d.reason, d.description, d.amount_minor::text AS "amountMinor", d.currency,
  d.status, d.priority, d.provisional_credit_requested AS "provisionalCreditRequested", d.credit_status AS "creditStatus",
  d.credit_account_id AS "creditAccountId",
  d.credit_transaction_id AS "creditTransactionId", d.credit_reversal_transaction_id AS "creditReversalTransactionId",
  d.assigned_to AS "assignedTo", assignee.display_name AS "assigneeName", d.due_at AS "dueAt", d.escalated_at AS "escalatedAt",
  d.opened_by AS "openedBy", opener.display_name AS "openedByName", d.resolved_by AS "resolvedBy",
  resolver.display_name AS "resolvedByName", d.resolution_note AS "resolutionNote", d.resolved_at AS "resolvedAt",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt", t.counterparty AS "originalCounterparty",
  t.description AS "originalDescription", t.amount_minor::text AS "originalAmountMinor", t.status AS "originalStatus",
  t.created_at AS "originalCreatedAt"
 FROM disputes d JOIN transactions t ON t.id = d.transaction_id JOIN users opener ON opener.id = d.opened_by
 LEFT JOIN users assignee ON assignee.id = d.assigned_to LEFT JOIN users resolver ON resolver.id = d.resolved_by`;

function serializeDispute(row: DisputeRow) {
  const { requestFingerprint, idempotencyKey, ...publicRow } = row; void requestFingerprint; void idempotencyKey;
  return { ...publicRow, amount: minorToMajorNumber(row.amountMinor, row.currency), open: isOpenDispute(row.status),
    provisionalCreditRequested: row.provisionalCreditRequested === 1, possibleEvents: disputePossibleEvents(row.status),
    originalTransaction: { id: row.transactionId, counterparty: row.originalCounterparty, description: row.originalDescription,
      amountMinor: row.originalAmountMinor, amount: minorToMajorNumber(row.originalAmountMinor, row.currency),
      currency: row.currency, status: row.originalStatus, createdAt: row.originalCreatedAt } };
}

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; disputeId: string; payload: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, 'dispute', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.disputeId,
    JSON.stringify(input.payload), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: 'dispute', resourceId: input.disputeId, data: input.payload });
}

async function disputeRow(database: DatabaseClient, organizationId: string, id: string, lock = false) {
  const suffix = lock ? ' FOR UPDATE OF d' : '';
  return (await database.prepare(`${disputeSelect} WHERE d.organization_id = ? AND d.id = ?${suffix}`)
    .bind(organizationId, id).first<DisputeRow>()) ?? null;
}

export async function listDisputes(organizationId: string) {
  const database = getDatabaseClient(); const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [rows, eligible] = await Promise.all([
    database.prepare(`${disputeSelect} WHERE d.organization_id = ? ORDER BY d.created_at DESC LIMIT 200`)
      .bind(organizationId).all<DisputeRow>(),
    database.prepare(
      `SELECT t.id, t.counterparty, t.description, t.amount_minor::text AS "amountMinor", t.currency, t.status,
        t.created_at AS "createdAt" FROM transactions t
       WHERE t.organization_id = ? AND t.status = 'settled' AND t.amount_minor < 0 AND t.created_at >= ?
         AND t.type NOT IN ('dispute_credit', 'dispute_credit_reversal', 'reversal')
         AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.organization_id = t.organization_id AND d.transaction_id = t.id)
       ORDER BY t.created_at DESC LIMIT 100`,
    ).bind(organizationId, cutoff).all<{
      id: string; counterparty: string; description: string; amountMinor: string; currency: Currency; status: string; createdAt: string;
    }>(),
  ]);
  return { disputes: rows.results.map(serializeDispute), eligibleTransactions: eligible.results.map((item) => ({ ...item,
    amount: minorToMajorNumber(item.amountMinor, item.currency), disputableAmountMinor: (-BigInt(item.amountMinor)).toString(),
    disputableAmount: minorToMajorNumber(-BigInt(item.amountMinor), item.currency) })) };
}

export async function retrieveDispute(organizationId: string, id: string) {
  const database = getDatabaseClient(); const row = await disputeRow(database, organizationId, id);
  if (!row) return null;
  const events = await database.prepare(
    `SELECT e.id, e.event, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.note,
      e.actor_id AS "actorId", u.display_name AS "actorName", e.created_at AS "createdAt"
     FROM dispute_events e JOIN users u ON u.id = e.actor_id
     WHERE e.organization_id = ? AND e.dispute_id = ? ORDER BY e.created_at ASC`,
  ).bind(organizationId, id).all<Record<string, unknown>>();
  return { dispute: serializeDispute(row), events: events.results };
}

export async function createDispute(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; transactionId: string;
  reason: DisputeReason; description: string; amountMinor: bigint; currency: Currency; provisionalCreditRequested: boolean;
}) {
  const fingerprint = await sha256(JSON.stringify({ transactionId: input.transactionId, reason: input.reason,
    description: input.description, amountMinor: input.amountMinor.toString(), currency: input.currency,
    provisionalCreditRequested: input.provisionalCreditRequested }));
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:dispute:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${disputeSelect} WHERE d.organization_id = ? AND d.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<DisputeRow>();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new DisputeError('La Idempotency-Key ya fue usada con otro payload.', 409, 'idempotency_mismatch');
      return { dispute: serializeDispute(existing), replayed: true };
    }
    const transaction = await database.prepare(
      `SELECT id, type, amount_minor::text AS "amountMinor", currency, status, created_at AS "createdAt"
       FROM transactions WHERE organization_id = ? AND id = ? FOR UPDATE`,
    ).bind(input.organizationId, input.transactionId).first<{
      id: string; type: string; amountMinor: string; currency: Currency; status: string; createdAt: string;
    }>();
    if (!transaction) throw new DisputeError('Movimiento no encontrado.', 404, 'transaction_not_found');
    if (transaction.status !== 'settled') {
      throw new DisputeError('El movimiento todavía no fue presentado y liquidado.', 409, 'transaction_not_presented');
    }
    if (transaction.currency !== input.currency) throw new DisputeError('La moneda no coincide con el movimiento.', 409, 'currency_mismatch');
    if (BigInt(transaction.amountMinor) >= 0n || ['dispute_credit', 'dispute_credit_reversal', 'reversal'].includes(transaction.type)) {
      throw new DisputeError('Este movimiento no admite una disputa.', 409, 'transaction_not_disputable');
    }
    if (new Date(transaction.createdAt).getTime() < Date.now() - 90 * 86_400_000) {
      throw new DisputeError('El plazo de 90 días para abrir la disputa venció.', 409, 'dispute_window_expired');
    }
    if (input.amountMinor <= 0n || input.amountMinor > -BigInt(transaction.amountMinor)) {
      throw new DisputeError('El monto debe ser positivo y no superar el movimiento original.', 400, 'invalid_dispute_amount');
    }
    const duplicate = await database.prepare('SELECT id FROM disputes WHERE organization_id = ? AND transaction_id = ? LIMIT 1')
      .bind(input.organizationId, input.transactionId).first<{ id: string }>();
    if (duplicate) throw new DisputeError('El movimiento ya tiene una disputa.', 409, 'transaction_already_disputed');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const productAccount = await database.prepare(
      `SELECT a.ledger_account_id AS "ledgerAccountId" FROM audit_events e
       JOIN accounts a ON a.id = e.payload::jsonb->>'accountId' AND a.organization_id = e.organization_id
       WHERE e.organization_id = ? AND e.resource_type = 'transaction' AND e.resource_id = ?
         AND e.action = 'payment.created' ORDER BY e.created_at DESC LIMIT 1`,
    ).bind(input.organizationId, input.transactionId).first<{ ledgerAccountId: string }>();
    const core = await database.prepare(
      `SELECT id FROM financial_accounts WHERE organization_id = ? AND currency = ? AND purpose = 'customer_funds' LIMIT 1`,
    ).bind(input.organizationId, transaction.currency).first<{ id: string }>();
    const creditAccountId = productAccount?.ledgerAccountId ?? core?.id;
    if (!creditAccountId) throw new DisputeError('No se pudo resolver la cuenta contable del crédito.', 409, 'dispute_credit_account_missing');
    const priority = input.reason === 'card_not_present' ? 'critical' : input.reason === 'duplicate' ? 'high' : 'medium';
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await database.prepare(
      `INSERT INTO disputes
        (id, organization_id, transaction_id, idempotency_key, request_fingerprint, reason, description,
         amount_minor, currency, status, priority, provisional_credit_requested, credit_status, credit_account_id,
         due_at, opened_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'opened', ?, ?, 'none', ?, ?, ?, ?, ?)`,
    ).bind(id, input.organizationId, input.transactionId, input.idempotencyKey, fingerprint, input.reason,
      input.description, input.amountMinor.toString(), transaction.currency, priority,
      input.provisionalCreditRequested ? 1 : 0, creditAccountId, dueAt, input.actor.userId, now, now).run();
    await database.prepare(
      `INSERT INTO dispute_events
        (id, organization_id, dispute_id, idempotency_key, request_fingerprint, event, from_status, to_status, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'created', NULL, 'opened', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.organizationId, id, `created:${input.idempotencyKey}`, fingerprint,
      input.description, input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'dispute.created', disputeId: id,
      payload: { transactionId: input.transactionId, reason: input.reason, amountMinor: input.amountMinor.toString(),
        currency: transaction.currency, provisionalCreditRequested: input.provisionalCreditRequested } });
    const created = await disputeRow(database, input.organizationId, id);
    if (!created) throw new DisputeError('No pudimos recuperar la disputa.', 500, 'dispute_create_failed');
    return { dispute: serializeDispute(created), replayed: false };
  });
}

export async function transitionDispute(input: {
  organizationId: string; actor: AuthUser; disputeId: string; event: DisputeEvent; note: string;
  idempotencyKey: string; approvalContext?: { requestId: string; requestedBy: string };
}, client: DatabaseClient = getDatabaseClient()) {
  const fingerprint = await sha256(JSON.stringify({ disputeId: input.disputeId, event: input.event, note: input.note }));
  return client.transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:dispute-event:${input.idempotencyKey}`).first();
    const existing = await database.prepare(
      `SELECT dispute_id AS "disputeId", request_fingerprint AS "requestFingerprint" FROM dispute_events
       WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
    ).bind(input.organizationId, input.idempotencyKey).first<{ disputeId: string; requestFingerprint: string }>();
    if (existing) {
      if (existing.disputeId !== input.disputeId || existing.requestFingerprint !== fingerprint) {
        throw new DisputeError('La Idempotency-Key ya fue usada con otra transición.', 409, 'idempotency_mismatch');
      }
      const replay = await disputeRow(database, input.organizationId, input.disputeId);
      if (!replay) throw new DisputeError('Disputa no encontrada.', 404, 'dispute_not_found');
      return { dispute: serializeDispute(replay), replayed: true };
    }
    const current = await disputeRow(database, input.organizationId, input.disputeId, true);
    if (!current) throw new DisputeError('Disputa no encontrada.', 404, 'dispute_not_found');
    const nextStatus = disputeNextStatus(current.status, input.event);
    if (!nextStatus) throw new DisputeError('La transición no está permitida desde el estado actual.', 409, 'invalid_dispute_transition');
    let creditStatus = current.creditStatus; let creditTransactionId = current.creditTransactionId;
    let creditReversalTransactionId = current.creditReversalTransactionId;
    if (input.event === 'start_review' && current.provisionalCreditRequested === 1 && creditStatus === 'none') {
      const credit = await postDisputeCreditInTransaction({ organizationId: input.organizationId, disputeId: current.id,
        amountMinor: BigInt(current.amountMinor), currency: current.currency, creditAccountId: current.creditAccountId,
        description: `Crédito provisional · disputa ${current.id}` }, database);
      creditStatus = 'posted'; creditTransactionId = credit.transactionId;
    }
    if (input.event === 'resolve_won') {
      if (creditStatus === 'posted') creditStatus = 'final';
      else if (creditStatus === 'none') {
        const credit = await postDisputeCreditInTransaction({ organizationId: input.organizationId, disputeId: current.id,
          amountMinor: BigInt(current.amountMinor), currency: current.currency, creditAccountId: current.creditAccountId,
          description: `Crédito definitivo · disputa ${current.id}` }, database);
        creditStatus = 'final'; creditTransactionId = credit.transactionId;
      }
    }
    if (['resolve_lost', 'reject', 'cancel'].includes(input.event) && creditStatus === 'posted' && creditTransactionId) {
      const reversal = await reverseDisputeCreditInTransaction({ organizationId: input.organizationId,
        disputeId: current.id, creditTransactionId }, database);
      creditStatus = 'reversed'; creditReversalTransactionId = reversal.transactionId;
    }
    const now = new Date().toISOString(); const terminal = !isOpenDispute(nextStatus);
    await database.prepare(
      `UPDATE disputes SET status = ?, credit_status = ?, credit_transaction_id = ?, credit_reversal_transaction_id = ?,
        resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?`,
    ).bind(nextStatus, creditStatus, creditTransactionId, creditReversalTransactionId,
      terminal ? input.note : current.resolutionNote, terminal ? input.actor.userId : current.resolvedBy,
      terminal ? now : current.resolvedAt, now, input.organizationId, current.id).run();
    await database.prepare(
      `INSERT INTO dispute_events
        (id, organization_id, dispute_id, idempotency_key, request_fingerprint, event, from_status, to_status, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.organizationId, current.id, input.idempotencyKey, fingerprint, input.event,
      current.status, nextStatus, input.note, input.actor.userId, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId,
      action: `dispute.${input.event}`, disputeId: current.id, payload: { fromStatus: current.status, toStatus: nextStatus,
        note: input.note, amountMinor: current.amountMinor, currency: current.currency, creditStatus,
        creditTransactionId, creditReversalTransactionId, approvalRequestId: input.approvalContext?.requestId ?? null,
        requestedBy: input.approvalContext?.requestedBy ?? null } });
    const updated = await disputeRow(database, input.organizationId, current.id);
    if (!updated) throw new DisputeError('No pudimos recuperar la disputa.', 500, 'dispute_update_failed');
    return { dispute: serializeDispute(updated), replayed: false };
  });
}
