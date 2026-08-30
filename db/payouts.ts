import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import type { NormalizedPayoutBatchItem, PayoutBeneficiaryType, PayoutDestinationType } from '@/app/lib/platform/payouts-input';
import { type DatabaseClient, getDatabaseClient } from './client';
import { createAccountPaymentInTransaction, LedgerError } from './ledger';
import { enqueueWebhookEvent } from './platform';

export class PayoutError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'payout_error') { super(message); }
}

type BeneficiaryRow = {
  id: string; externalReference: string; name: string; entityType: PayoutBeneficiaryType; country: string; currency: Currency;
  destinationType: PayoutDestinationType; destinationHash?: string; destinationLast4: string; bankCode: string | null;
  status: 'active' | 'suspended'; createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
  idempotencyKey?: string; requestFingerprint?: string;
};

type PayoutItemRow = {
  id: string; batchId: string; beneficiaryId: string; beneficiaryName: string; beneficiaryReference: string;
  destinationType: PayoutDestinationType; destinationLast4: string; externalReference: string; amountMinor: string; currency: Currency;
  description: string; status: 'pending' | 'processing' | 'review' | 'settled' | 'failed' | 'cancelled';
  transactionId: string | null; failureCode: string | null; failureMessage: string | null; attemptCount: number;
  processedAt: string | null; createdAt: string; updatedAt: string;
};

type PayoutBatchRow = {
  id: string; organizationId?: string; sourceAccountId: string; sourceAccountReference: string; externalReference: string;
  description: string; currency: Currency;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'processing' | 'requires_attention' | 'completed' | 'partially_failed' | 'failed' | 'cancelled';
  totalAmountMinor: string; itemCount: number; scheduledFor: string | null; processBefore: string | null;
  processingLeaseUntil?: string | null; submittedAt: string | null; startedAt: string | null; completedAt: string | null;
  cancelledAt: string | null; createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
  idempotencyKey?: string; requestFingerprint?: string;
};

const beneficiarySelect = `SELECT b.id, b.external_reference AS "externalReference", b.name, b.entity_type AS "entityType",
  b.country, b.currency, b.destination_type AS "destinationType", b.destination_hash AS "destinationHash",
  b.destination_last4 AS "destinationLast4", b.bank_code AS "bankCode", b.status, b.created_by AS "createdBy",
  creator.display_name AS "createdByName", b.idempotency_key AS "idempotencyKey", b.request_fingerprint AS "requestFingerprint",
  b.created_at AS "createdAt", b.updated_at AS "updatedAt" FROM payout_beneficiaries b JOIN users creator ON creator.id = b.created_by`;

const batchSelect = `SELECT b.id, b.organization_id AS "organizationId", b.source_account_id AS "sourceAccountId",
  a.account_reference AS "sourceAccountReference", b.external_reference AS "externalReference", b.description, b.currency, b.status,
  b.total_amount_minor::text AS "totalAmountMinor", b.item_count AS "itemCount", b.scheduled_for AS "scheduledFor",
  b.process_before AS "processBefore", b.processing_lease_until AS "processingLeaseUntil", b.submitted_at AS "submittedAt",
  b.started_at AS "startedAt", b.completed_at AS "completedAt", b.cancelled_at AS "cancelledAt", b.created_by AS "createdBy",
  creator.display_name AS "createdByName", b.idempotency_key AS "idempotencyKey", b.request_fingerprint AS "requestFingerprint",
  b.created_at AS "createdAt", b.updated_at AS "updatedAt" FROM payout_batches b JOIN accounts a ON a.id = b.source_account_id
  JOIN users creator ON creator.id = b.created_by`;

const itemSelect = `SELECT i.id, i.batch_id AS "batchId", i.beneficiary_id AS "beneficiaryId", beneficiary.name AS "beneficiaryName",
  beneficiary.external_reference AS "beneficiaryReference", beneficiary.destination_type AS "destinationType",
  beneficiary.destination_last4 AS "destinationLast4", i.external_reference AS "externalReference",
  i.amount_minor::text AS "amountMinor", i.currency, i.description, i.status, i.transaction_id AS "transactionId",
  i.failure_code AS "failureCode", i.failure_message AS "failureMessage", i.attempt_count AS "attemptCount",
  i.processed_at AS "processedAt", i.created_at AS "createdAt", i.updated_at AS "updatedAt"
  FROM payout_items i JOIN payout_beneficiaries beneficiary ON beneficiary.id = i.beneficiary_id`;

function publicBeneficiary(row: BeneficiaryRow) {
  const { destinationHash, idempotencyKey, requestFingerprint, ...safe } = row;
  void destinationHash; void idempotencyKey; void requestFingerprint;
  return safe;
}

function publicItem(row: PayoutItemRow) {
  return { ...row, amount: minorToMajorNumber(row.amountMinor, row.currency) };
}

function publicBatch(row: PayoutBatchRow, items: PayoutItemRow[] = []) {
  const { organizationId, processingLeaseUntil, idempotencyKey, requestFingerprint, ...safe } = row;
  void organizationId; void processingLeaseUntil; void idempotencyKey; void requestFingerprint;
  return { ...safe, totalAmount: minorToMajorNumber(row.totalAmountMinor, row.currency), items: items.map(publicItem) };
}

async function fingerprint(value: Record<string, unknown>) { return sha256(JSON.stringify(value)); }

async function audit(database: DatabaseClient, input: {
  organizationId: string; actorId: string; action: string; resourceType: string; resourceId: string; payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action,
    input.resourceType, input.resourceId, JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action,
    resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

async function batchWithItems(database: DatabaseClient, organizationId: string, id: string) {
  const row = await database.prepare(`${batchSelect} WHERE b.organization_id = ? AND b.id = ? LIMIT 1`)
    .bind(organizationId, id).first<PayoutBatchRow>();
  if (!row) return null;
  const items = await database.prepare(`${itemSelect} WHERE i.organization_id = ? AND i.batch_id = ? ORDER BY i.created_at, i.id`)
    .bind(organizationId, id).all<PayoutItemRow>();
  return publicBatch(row, items.results);
}

export async function listPayoutBeneficiaries(organizationId: string) {
  const rows = await getDatabaseClient().prepare(`${beneficiarySelect} WHERE b.organization_id = ? ORDER BY b.name, b.id LIMIT 500`)
    .bind(organizationId).all<BeneficiaryRow>();
  return rows.results.map(publicBeneficiary);
}

export async function retrievePayoutBeneficiary(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${beneficiarySelect} WHERE b.organization_id = ? AND b.id = ? LIMIT 1`)
    .bind(organizationId, id).first<BeneficiaryRow>();
  return row ? publicBeneficiary(row) : null;
}

export async function createPayoutBeneficiary(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; externalReference: string; name: string;
  entityType: PayoutBeneficiaryType; country: string; currency: Currency; destinationType: PayoutDestinationType;
  destination: string; bankCode: string | null;
}) {
  const destinationHash = await sha256(`${input.organizationId}:payout-destination:${input.destination}`);
  const requestFingerprint = await fingerprint({ externalReference: input.externalReference, name: input.name, entityType: input.entityType,
    country: input.country, currency: input.currency, destinationType: input.destinationType, destinationHash, bankCode: input.bankCode });
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payout-beneficiary:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${beneficiarySelect} WHERE b.organization_id = ? AND b.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<BeneficiaryRow>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new PayoutError('La Idempotency-Key ya fue usada con otro beneficiario.', 409, 'idempotency_mismatch');
      return { beneficiary: publicBeneficiary(existing), replayed: true };
    }
    const duplicateReference = await database.prepare('SELECT id FROM payout_beneficiaries WHERE organization_id = ? AND external_reference = ? LIMIT 1')
      .bind(input.organizationId, input.externalReference).first<{ id: string }>();
    if (duplicateReference) throw new PayoutError('La referencia externa del beneficiario ya existe.', 409, 'beneficiary_reference_exists');
    const duplicateDestination = await database.prepare('SELECT id FROM payout_beneficiaries WHERE organization_id = ? AND destination_hash = ? LIMIT 1')
      .bind(input.organizationId, destinationHash).first<{ id: string }>();
    if (duplicateDestination) throw new PayoutError('El destino ya pertenece a otro beneficiario.', 409, 'beneficiary_destination_exists');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(`INSERT INTO payout_beneficiaries
      (id, organization_id, idempotency_key, request_fingerprint, external_reference, name, entity_type, country, currency,
       destination_type, destination_hash, destination_last4, bank_code, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).bind(id, input.organizationId, input.idempotencyKey,
      requestFingerprint, input.externalReference, input.name, input.entityType, input.country, input.currency, input.destinationType,
      destinationHash, input.destination.slice(-4), input.bankCode, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'payout.beneficiary_created',
      resourceType: 'payout_beneficiary', resourceId: id, payload: { externalReference: input.externalReference, entityType: input.entityType,
        country: input.country, currency: input.currency, destinationType: input.destinationType, destinationLast4: input.destination.slice(-4), status: 'active' } });
    return { beneficiary: publicBeneficiary((await database.prepare(`${beneficiarySelect} WHERE b.id = ?`).bind(id).first<BeneficiaryRow>())!), replayed: false };
  });
}

export async function updatePayoutBeneficiaryStatus(input: {
  organizationId: string; actor: AuthUser; beneficiaryId: string; action: 'activate' | 'suspend'; idempotencyKey: string;
}) {
  const event = input.action === 'activate' ? 'payout.beneficiary_activated' : 'payout.beneficiary_suspended';
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payout-beneficiary-status:${input.idempotencyKey}`).first();
    const prior = await database.prepare(`SELECT resource_id AS "resourceId", action FROM audit_events WHERE organization_id = ?
      AND resource_type = 'payout_beneficiary' AND action IN ('payout.beneficiary_activated', 'payout.beneficiary_suspended')
      AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey)
      .first<{ resourceId: string; action: string }>();
    if (prior) {
      if (prior.resourceId !== input.beneficiaryId || prior.action !== event) throw new PayoutError('La Idempotency-Key ya fue usada con otra transición.', 409, 'idempotency_mismatch');
      const replay = await database.prepare(`${beneficiarySelect} WHERE b.organization_id = ? AND b.id = ?`).bind(input.organizationId, input.beneficiaryId).first<BeneficiaryRow>();
      return { beneficiary: publicBeneficiary(replay!), replayed: true };
    }
    const row = await database.prepare('SELECT status FROM payout_beneficiaries WHERE organization_id = ? AND id = ? FOR UPDATE')
      .bind(input.organizationId, input.beneficiaryId).first<{ status: string }>();
    if (!row) throw new PayoutError('Beneficiario no encontrado.', 404, 'payout_beneficiary_not_found');
    const status = input.action === 'activate' ? 'active' : 'suspended'; const now = new Date().toISOString();
    if (row.status !== status) await database.prepare('UPDATE payout_beneficiaries SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, input.beneficiaryId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: event,
      resourceType: 'payout_beneficiary', resourceId: input.beneficiaryId, payload: { idempotencyKey: input.idempotencyKey, status } });
    const updated = await database.prepare(`${beneficiarySelect} WHERE b.organization_id = ? AND b.id = ?`).bind(input.organizationId, input.beneficiaryId).first<BeneficiaryRow>();
    return { beneficiary: publicBeneficiary(updated!), replayed: false };
  });
}

export async function listPayoutBatches(organizationId: string) {
  const database = getDatabaseClient();
  const rows = await database.prepare(`${batchSelect} WHERE b.organization_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT 200`)
    .bind(organizationId).all<PayoutBatchRow>();
  return Promise.all(rows.results.map(async (row) => {
    const items = await database.prepare(`${itemSelect} WHERE i.organization_id = ? AND i.batch_id = ? ORDER BY i.created_at, i.id`)
      .bind(organizationId, row.id).all<PayoutItemRow>();
    return publicBatch(row, items.results);
  }));
}

export function retrievePayoutBatch(organizationId: string, id: string) {
  return batchWithItems(getDatabaseClient(), organizationId, id);
}

export async function createPayoutBatch(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; sourceAccountId: string; externalReference: string;
  description: string; currency: Currency; scheduledFor: string | null; processBefore: string | null; items: NormalizedPayoutBatchItem[];
}) {
  const requestFingerprint = await fingerprint({ sourceAccountId: input.sourceAccountId, externalReference: input.externalReference,
    description: input.description, currency: input.currency, scheduledFor: input.scheduledFor, processBefore: input.processBefore,
    items: input.items.map((item) => ({ ...item, amountMinor: item.amountMinor.toString() })) });
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payout-batch:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${batchSelect} WHERE b.organization_id = ? AND b.idempotency_key = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<PayoutBatchRow>();
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new PayoutError('La Idempotency-Key ya fue usada con otro lote.', 409, 'idempotency_mismatch');
      return { batch: await batchWithItems(database, input.organizationId, existing.id), replayed: true };
    }
    const account = await database.prepare('SELECT currency, status FROM accounts WHERE organization_id = ? AND id = ? FOR SHARE')
      .bind(input.organizationId, input.sourceAccountId).first<{ currency: Currency; status: string }>();
    if (!account) throw new PayoutError('Cuenta de origen no encontrada.', 404, 'account_not_found');
    if (account.status !== 'active') throw new PayoutError('La cuenta de origen no está activa.', 409, 'account_inactive');
    if (account.currency !== input.currency) throw new PayoutError('La moneda no coincide con la cuenta de origen.', 409, 'currency_mismatch');
    const duplicate = await database.prepare('SELECT id FROM payout_batches WHERE organization_id = ? AND external_reference = ? LIMIT 1')
      .bind(input.organizationId, input.externalReference).first<{ id: string }>();
    if (duplicate) throw new PayoutError('La referencia externa del lote ya existe.', 409, 'payout_batch_reference_exists');
    for (const item of input.items) {
      const beneficiary = await database.prepare('SELECT currency, status FROM payout_beneficiaries WHERE organization_id = ? AND id = ? FOR SHARE')
        .bind(input.organizationId, item.beneficiaryId).first<{ currency: Currency; status: string }>();
      if (!beneficiary) throw new PayoutError(`Beneficiario no encontrado para ${item.externalReference}.`, 404, 'payout_beneficiary_not_found');
      if (beneficiary.status !== 'active') throw new PayoutError(`El beneficiario de ${item.externalReference} está suspendido.`, 409, 'payout_beneficiary_suspended');
      if (beneficiary.currency !== input.currency) throw new PayoutError(`La moneda del beneficiario de ${item.externalReference} no coincide.`, 409, 'currency_mismatch');
    }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const total = input.items.reduce((sum, item) => sum + item.amountMinor, 0n);
    await database.prepare(`INSERT INTO payout_batches
      (id, organization_id, source_account_id, idempotency_key, request_fingerprint, external_reference, description, currency,
       status, total_amount_minor, item_count, scheduled_for, process_before, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.organizationId, input.sourceAccountId,
      input.idempotencyKey, requestFingerprint, input.externalReference, input.description, input.currency, total.toString(), input.items.length,
      input.scheduledFor, input.processBefore, input.actor.userId, now, now).run();
    for (const item of input.items) await database.prepare(`INSERT INTO payout_items
      (id, organization_id, batch_id, beneficiary_id, external_reference, amount_minor, currency, description, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`).bind(crypto.randomUUID(), input.organizationId, id, item.beneficiaryId,
      item.externalReference, item.amountMinor.toString(), input.currency, item.description, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'payout.batch_created',
      resourceType: 'payout_batch', resourceId: id, payload: { externalReference: input.externalReference, sourceAccountId: input.sourceAccountId,
        currency: input.currency, totalAmountMinor: total.toString(), itemCount: input.items.length, scheduledFor: input.scheduledFor,
        processBefore: input.processBefore, status: 'draft' } });
    return { batch: await batchWithItems(database, input.organizationId, id), replayed: false };
  });
}

async function approvalById(database: DatabaseClient, organizationId: string, id: string) {
  return database.prepare(`SELECT ar.id, ar.action_type AS "actionType", ar.resource_type AS "resourceType", ar.resource_id AS "resourceId",
    ar.status, ar.request_payload::jsonb AS "requestPayload", ar.requested_by AS "requestedBy", requester.display_name AS "requestedByName",
    ar.resolved_by AS "resolvedBy", resolver.display_name AS "resolvedByName", ar.resolution_reason AS "resolutionReason",
    ar.expires_at AS "expiresAt", ar.resolved_at AS "resolvedAt", ar.executed_at AS "executedAt", ar.created_at AS "createdAt", ar.updated_at AS "updatedAt"
    FROM approval_requests ar JOIN users requester ON requester.id = ar.requested_by LEFT JOIN users resolver ON resolver.id = ar.resolved_by
    WHERE ar.organization_id = ? AND ar.id = ? LIMIT 1`).bind(organizationId, id).first<Record<string, unknown>>();
}

export async function submitPayoutBatch(input: {
  organizationId: string; actor: AuthUser; batchId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payout-batch-submit:${input.idempotencyKey}`).first();
    const prior = await database.prepare(`SELECT resource_id AS "resourceId", payload FROM audit_events WHERE organization_id = ?
      AND action IN ('payout.batch_submitted', 'payout.batch_approval_pending') AND resource_type = 'payout_batch'
      AND payload::jsonb->>'idempotencyKey' = ? ORDER BY created_at DESC LIMIT 1`).bind(input.organizationId, input.idempotencyKey)
      .first<{ resourceId: string; payload: string }>();
    if (prior) {
      if (prior.resourceId !== input.batchId) throw new PayoutError('La Idempotency-Key ya fue usada para otro envío.', 409, 'idempotency_mismatch');
      let approvalId: string | null = null; try { approvalId = (JSON.parse(prior.payload) as { approvalId?: string }).approvalId ?? null; } catch { /* legacy */ }
      return { batch: await batchWithItems(database, input.organizationId, input.batchId),
        approval: approvalId ? await approvalById(database, input.organizationId, approvalId) : null,
        requiresApproval: Boolean(approvalId), replayed: true, scheduleNow: false };
    }
    const row = await database.prepare(`${batchSelect} WHERE b.organization_id = ? AND b.id = ? FOR UPDATE OF b`)
      .bind(input.organizationId, input.batchId).first<PayoutBatchRow>();
    if (!row) throw new PayoutError('Lote de payouts no encontrado.', 404, 'payout_batch_not_found');
    if (row.status !== 'draft') throw new PayoutError('Sólo un lote en borrador puede enviarse.', 409, 'payout_batch_not_draft');
    const now = new Date().toISOString();
    if (row.processBefore && row.processBefore <= now) throw new PayoutError('La ventana de procesamiento del lote venció.', 409, 'payout_batch_deadline_expired');
    const account = await database.prepare('SELECT currency, status FROM accounts WHERE organization_id = ? AND id = ? FOR SHARE')
      .bind(input.organizationId, row.sourceAccountId).first<{ currency: Currency; status: string }>();
    if (!account || account.status !== 'active' || account.currency !== row.currency) throw new PayoutError('La cuenta de origen ya no es operable.', 409, 'source_account_unavailable');
    const inactive = await database.prepare(`SELECT i.external_reference AS "externalReference" FROM payout_items i
      JOIN payout_beneficiaries beneficiary ON beneficiary.id = i.beneficiary_id
      WHERE i.organization_id = ? AND i.batch_id = ? AND beneficiary.status <> 'active' LIMIT 1`)
      .bind(input.organizationId, input.batchId).first<{ externalReference: string }>();
    if (inactive) throw new PayoutError(`El beneficiario de ${inactive.externalReference} ya no está activo.`, 409, 'payout_beneficiary_suspended');
    await database.prepare('SELECT pg_advisory_xact_lock_shared(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:approval-policy:payout_batch.execute`).first();
    const policy = await database.prepare(`SELECT expires_in_minutes AS "expiresInMinutes" FROM approval_policies
      WHERE organization_id = ? AND action_type = 'payout_batch.execute' AND enabled = 1 LIMIT 1`)
      .bind(input.organizationId).first<{ expiresInMinutes: number }>();
    if (policy) {
      const approvalFingerprint = await fingerprint({ actionType: 'payout_batch.execute', batchId: row.id, totalAmountMinor: row.totalAmountMinor,
        currency: row.currency, itemCount: row.itemCount, scheduledFor: row.scheduledFor, processBefore: row.processBefore });
      const conflictingKey = await database.prepare('SELECT id FROM approval_requests WHERE organization_id = ? AND idempotency_key = ? LIMIT 1')
        .bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
      if (conflictingKey) throw new PayoutError('La Idempotency-Key ya fue usada para otra aprobación.', 409, 'idempotency_mismatch');
      const pending = await database.prepare(`SELECT id FROM approval_requests WHERE organization_id = ? AND action_type = 'payout_batch.execute'
        AND resource_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1`).bind(input.organizationId, row.id, now).first<{ id: string }>();
      if (pending) throw new PayoutError('El lote ya tiene una aprobación pendiente.', 409, 'approval_request_conflict');
      const approvalId = crypto.randomUUID(); const expiresAt = new Date(Date.now() + policy.expiresInMinutes * 60_000).toISOString();
      const payload = { externalReference: row.externalReference, description: row.description, sourceAccountId: row.sourceAccountId,
        currency: row.currency, totalAmountMinor: row.totalAmountMinor, itemCount: row.itemCount, scheduledFor: row.scheduledFor,
        processBefore: row.processBefore, sandbox: true };
      await database.prepare(`INSERT INTO approval_requests
        (id, organization_id, action_type, resource_type, resource_id, idempotency_key, request_fingerprint, status,
         request_payload, requested_by, expires_at, created_at, updated_at)
        VALUES (?, ?, 'payout_batch.execute', 'payout_batch', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`).bind(approvalId,
        input.organizationId, row.id, input.idempotencyKey, approvalFingerprint, JSON.stringify(payload), input.actor.userId, expiresAt, now, now).run();
      await database.prepare("UPDATE payout_batches SET status = 'pending_approval', submitted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, row.id).run();
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'approval.request_created',
        resourceType: 'approval_request', resourceId: approvalId, payload: { actionType: 'payout_batch.execute', resourceType: 'payout_batch', resourceId: row.id, expiresAt, ...payload } });
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'payout.batch_approval_pending',
        resourceType: 'payout_batch', resourceId: row.id, payload: { idempotencyKey: input.idempotencyKey, approvalId, status: 'pending_approval' } });
      return { batch: await batchWithItems(database, input.organizationId, row.id), approval: await approvalById(database, input.organizationId, approvalId),
        requiresApproval: true, replayed: false, scheduleNow: false };
    }
    const status = row.scheduledFor && row.scheduledFor > now ? 'scheduled' : 'processing';
    await database.prepare('UPDATE payout_batches SET status = ?, submitted_at = ?, updated_at = ? WHERE id = ?').bind(status, now, now, row.id).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'payout.batch_submitted',
      resourceType: 'payout_batch', resourceId: row.id, payload: { idempotencyKey: input.idempotencyKey, status, scheduledFor: row.scheduledFor } });
    return { batch: await batchWithItems(database, input.organizationId, row.id), approval: null,
      requiresApproval: false, replayed: false, scheduleNow: status === 'processing' };
  });
}

export async function authorizePayoutBatchInTransaction(database: DatabaseClient, input: {
  organizationId: string; actorId: string; batchId: string; approvalRequestId: string;
}) {
  const row = await database.prepare(`${batchSelect} WHERE b.organization_id = ? AND b.id = ? FOR UPDATE OF b`)
    .bind(input.organizationId, input.batchId).first<PayoutBatchRow>();
  if (!row || row.status !== 'pending_approval') throw new PayoutError('El lote ya no espera aprobación.', 409, 'payout_batch_not_pending_approval');
  const now = new Date().toISOString();
  if (row.processBefore && row.processBefore <= now) throw new PayoutError('La ventana de procesamiento del lote venció.', 409, 'payout_batch_deadline_expired');
  const status = row.scheduledFor && row.scheduledFor > now ? 'scheduled' : 'processing';
  await database.prepare('UPDATE payout_batches SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, row.id).run();
  await audit(database, { organizationId: input.organizationId, actorId: input.actorId, action: 'payout.batch_approved',
    resourceType: 'payout_batch', resourceId: row.id, payload: { approvalRequestId: input.approvalRequestId, status } });
  return batchWithItems(database, input.organizationId, row.id);
}

export async function closePayoutBatchApprovalInTransaction(database: DatabaseClient, input: {
  organizationId: string; actorId: string; batchId: string; approvalRequestId: string; outcome: 'rejected' | 'cancelled' | 'expired' | 'failed';
}) {
  const row = await database.prepare('SELECT status FROM payout_batches WHERE organization_id = ? AND id = ? FOR UPDATE')
    .bind(input.organizationId, input.batchId).first<{ status: string }>();
  if (!row || row.status !== 'pending_approval') return;
  const now = new Date().toISOString();
  const failed = input.outcome === 'failed'; const status = failed ? 'failed' : 'cancelled';
  await database.prepare(`UPDATE payout_batches SET status = ?, completed_at = ?, cancelled_at = ?, updated_at = ? WHERE id = ?`)
    .bind(status, failed ? now : null, failed ? null : now, now, input.batchId).run();
  await database.prepare(`UPDATE payout_items SET status = ?, failure_code = ?, failure_message = ?, processed_at = ?, updated_at = ?
    WHERE batch_id = ? AND status = 'pending'`).bind(failed ? 'failed' : 'cancelled', failed ? 'approval_failed' : null,
      failed ? 'La revalidación protegida del lote falló.' : null, now, now, input.batchId).run();
  await audit(database, { organizationId: input.organizationId, actorId: input.actorId,
    action: failed ? 'payout.batch_failed' : 'payout.batch_cancelled', resourceType: 'payout_batch', resourceId: input.batchId,
    payload: { approvalRequestId: input.approvalRequestId, outcome: input.outcome, status } });
}

export async function cancelPayoutBatch(input: {
  organizationId: string; actor: AuthUser; batchId: string; idempotencyKey: string;
}) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
      .bind(`${input.organizationId}:payout-batch-cancel:${input.idempotencyKey}`).first();
    const prior = await database.prepare(`SELECT resource_id AS "resourceId" FROM audit_events WHERE organization_id = ?
      AND action = 'payout.batch_cancelled' AND resource_type = 'payout_batch' AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`)
      .bind(input.organizationId, input.idempotencyKey).first<{ resourceId: string }>();
    if (prior) {
      if (prior.resourceId !== input.batchId) throw new PayoutError('La Idempotency-Key ya fue usada para otra cancelación.', 409, 'idempotency_mismatch');
      return { batch: await batchWithItems(database, input.organizationId, input.batchId), replayed: true };
    }
    const row = await database.prepare('SELECT status FROM payout_batches WHERE organization_id = ? AND id = ? FOR UPDATE')
      .bind(input.organizationId, input.batchId).first<{ status: string }>();
    if (!row) throw new PayoutError('Lote de payouts no encontrado.', 404, 'payout_batch_not_found');
    if (!['draft', 'scheduled'].includes(row.status)) throw new PayoutError('El lote ya no puede cancelarse directamente.', 409, 'payout_batch_not_cancellable');
    const now = new Date().toISOString();
    await database.prepare("UPDATE payout_batches SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(now, now, input.batchId).run();
    await database.prepare("UPDATE payout_items SET status = 'cancelled', processed_at = ?, updated_at = ? WHERE batch_id = ? AND status = 'pending'")
      .bind(now, now, input.batchId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'payout.batch_cancelled',
      resourceType: 'payout_batch', resourceId: input.batchId, payload: { idempotencyKey: input.idempotencyKey, status: 'cancelled' } });
    return { batch: await batchWithItems(database, input.organizationId, input.batchId), replayed: false };
  });
}

function terminalBatchStatus(counts: { pending: number; processing: number; review: number; settled: number; failed: number; cancelled: number }) {
  if (counts.review > 0) return 'requires_attention';
  if (counts.pending > 0 || counts.processing > 0) return 'scheduled';
  if (counts.settled > 0 && counts.failed + counts.cancelled > 0) return 'partially_failed';
  if (counts.settled > 0) return 'completed';
  return 'failed';
}

export async function recomputePayoutBatchInTransaction(database: DatabaseClient, organizationId: string, batchId: string, actorId: string) {
  const batch = await database.prepare('SELECT status FROM payout_batches WHERE organization_id = ? AND id = ? FOR UPDATE')
    .bind(organizationId, batchId).first<{ status: string }>();
  if (!batch) return null;
  const rows = await database.prepare(`SELECT status, COUNT(*)::int AS count FROM payout_items WHERE organization_id = ? AND batch_id = ? GROUP BY status`)
    .bind(organizationId, batchId).all<{ status: string; count: number }>();
  const counts = { pending: 0, processing: 0, review: 0, settled: 0, failed: 0, cancelled: 0 };
  for (const row of rows.results) if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.count);
  const status = terminalBatchStatus(counts);
  const now = new Date().toISOString(); const completedAt = ['completed', 'partially_failed', 'failed'].includes(status) ? now : null;
  await database.prepare('UPDATE payout_batches SET status = ?, processing_lease_until = NULL, completed_at = ?, updated_at = ? WHERE id = ?')
    .bind(status, completedAt, now, batchId).run();
  if (batch.status !== status) {
    const action = `payout.batch_${status}`;
    await audit(database, { organizationId, actorId, action, resourceType: 'payout_batch', resourceId: batchId, payload: { status, counts } });
  }
  return status;
}

async function claimPayoutBatch(organizationId: string, batchId: string) {
  return getDatabaseClient().transaction(async (database) => {
    const row = await database.prepare(`${batchSelect} WHERE b.organization_id = ? AND b.id = ? FOR UPDATE OF b`)
      .bind(organizationId, batchId).first<PayoutBatchRow>();
    if (!row || !['scheduled', 'processing'].includes(row.status)) return null;
    const now = new Date().toISOString();
    if (row.status === 'scheduled' && row.scheduledFor && row.scheduledFor > now) return null;
    if (row.status === 'processing' && row.processingLeaseUntil && row.processingLeaseUntil > now) return null;
    if (row.processBefore && row.processBefore <= now) {
      await database.prepare(`UPDATE payout_items SET status = 'failed', failure_code = 'processing_deadline_expired',
        failure_message = 'La ventana de procesamiento venció.', processed_at = ?, updated_at = ?
        WHERE batch_id = ? AND status IN ('pending', 'processing')`).bind(now, now, row.id).run();
      await recomputePayoutBatchInTransaction(database, organizationId, row.id, row.createdBy);
      return null;
    }
    const leaseUntil = new Date(Date.now() + 90_000).toISOString();
    await database.prepare("UPDATE payout_batches SET status = 'processing', processing_lease_until = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
      .bind(leaseUntil, now, now, row.id).run();
    if (row.status !== 'processing') await audit(database, { organizationId, actorId: row.createdBy, action: 'payout.batch_processing',
      resourceType: 'payout_batch', resourceId: row.id, payload: { status: 'processing' } });
    return row;
  });
}

async function processPayoutItem(organizationId: string, batch: PayoutBatchRow, itemId: string) {
  try {
    return await getDatabaseClient().transaction(async (database) => {
      const item = await database.prepare(`${itemSelect} WHERE i.organization_id = ? AND i.id = ? FOR UPDATE OF i`)
        .bind(organizationId, itemId).first<PayoutItemRow>();
      if (!item || item.status !== 'pending') return item?.status ?? 'missing';
      const attempt = item.attemptCount + 1; const now = new Date().toISOString();
      await database.prepare("UPDATE payout_items SET status = 'processing', attempt_count = ?, updated_at = ? WHERE id = ?")
        .bind(attempt, now, item.id).run();
      const beneficiary = await database.prepare('SELECT name, status FROM payout_beneficiaries WHERE organization_id = ? AND id = ? FOR SHARE')
        .bind(organizationId, item.beneficiaryId).first<{ name: string; status: string }>();
      if (!beneficiary || beneficiary.status !== 'active') {
        await database.prepare(`UPDATE payout_items SET status = 'failed', failure_code = 'beneficiary_unavailable',
          failure_message = 'El beneficiario no está activo.', processed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, item.id).run();
        await audit(database, { organizationId, actorId: batch.createdBy, action: 'payout.item_failed', resourceType: 'payout_item', resourceId: item.id,
          payload: { batchId: batch.id, externalReference: item.externalReference, failureCode: 'beneficiary_unavailable' } });
        return 'failed';
      }
      const actor = await database.prepare(`SELECT id AS "userId", username, display_name AS "displayName", email,
        email_verified AS "emailVerified", mfa_enabled AS "mfaEnabled" FROM users WHERE id = ? LIMIT 1`).bind(batch.createdBy).first<AuthUser>();
      if (!actor) throw new PayoutError('No se encontró el actor del lote.', 500, 'payout_actor_missing');
      try {
        const execution = await createAccountPaymentInTransaction({ organizationId, actor, idempotencyKey: `payout-item:${item.id}`,
          accountId: batch.sourceAccountId, direction: 'cash_out', counterparty: beneficiary.name, description: item.description,
          amountMinor: BigInt(item.amountMinor), currency: item.currency }, database);
        if ('declined' in execution) {
          await database.prepare(`UPDATE payout_items SET status = 'failed', failure_code = 'risk_declined',
            failure_message = 'La política de riesgo rechazó el payout.', processed_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, item.id).run();
          await audit(database, { organizationId, actorId: actor.userId, action: 'payout.item_failed', resourceType: 'payout_item', resourceId: item.id,
            payload: { batchId: batch.id, externalReference: item.externalReference, failureCode: 'risk_declined' } });
          return 'failed';
        }
        const status = execution.payment.status === 'review' ? 'review' : 'settled';
        await database.prepare('UPDATE payout_items SET status = ?, transaction_id = ?, failure_code = NULL, failure_message = NULL, processed_at = ?, updated_at = ? WHERE id = ?')
          .bind(status, execution.payment.id, now, now, item.id).run();
        await audit(database, { organizationId, actorId: actor.userId, action: `payout.item_${status}`, resourceType: 'payout_item', resourceId: item.id,
          payload: { batchId: batch.id, externalReference: item.externalReference, transactionId: execution.payment.id, status } });
        return status;
      } catch (error) {
        if (!(error instanceof LedgerError) || error.status >= 500) throw error;
        await database.prepare('UPDATE payout_items SET status = ?, failure_code = ?, failure_message = ?, processed_at = ?, updated_at = ? WHERE id = ?')
          .bind('failed', error.code, error.message, now, now, item.id).run();
        await audit(database, { organizationId, actorId: actor.userId, action: 'payout.item_failed', resourceType: 'payout_item', resourceId: item.id,
          payload: { batchId: batch.id, externalReference: item.externalReference, failureCode: error.code } });
        return 'failed';
      }
    });
  } catch (error) {
    await getDatabaseClient().transaction(async (database) => {
      const item = await database.prepare('SELECT attempt_count AS "attemptCount", status FROM payout_items WHERE organization_id = ? AND id = ? FOR UPDATE')
        .bind(organizationId, itemId).first<{ attemptCount: number; status: string }>();
      if (!item || !['pending', 'processing'].includes(item.status)) return;
      const attempt = Math.min(3, Math.max(1, item.attemptCount)); const now = new Date().toISOString(); const exhausted = attempt >= 3;
      await database.prepare(`UPDATE payout_items SET status = ?, attempt_count = ?, failure_code = ?, failure_message = ?, processed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(exhausted ? 'failed' : 'pending', attempt, exhausted ? 'processing_failed' : 'retry_scheduled',
          error instanceof Error ? error.message.slice(0, 500) : 'Error transitorio', exhausted ? now : null, now, itemId).run();
      if (exhausted) await audit(database, { organizationId, actorId: batch.createdBy, action: 'payout.item_failed', resourceType: 'payout_item', resourceId: itemId,
        payload: { batchId: batch.id, failureCode: 'processing_failed' } });
    });
    return 'retry';
  }
}

export async function processPayoutBatchById(organizationId: string, batchId: string) {
  const batch = await claimPayoutBatch(organizationId, batchId);
  if (!batch) return null;
  const items = await getDatabaseClient().prepare(`SELECT id FROM payout_items WHERE organization_id = ? AND batch_id = ? AND status = 'pending' ORDER BY created_at, id`)
    .bind(organizationId, batchId).all<{ id: string }>();
  for (const item of items.results) await processPayoutItem(organizationId, batch, item.id);
  await getDatabaseClient().transaction((database) => recomputePayoutBatchInTransaction(database, organizationId, batchId, batch.createdBy));
  return retrievePayoutBatch(organizationId, batchId);
}

export async function processDuePayoutBatches(limit = 25) {
  const now = new Date().toISOString();
  const rows = await getDatabaseClient().prepare(`SELECT id, organization_id AS "organizationId" FROM payout_batches
    WHERE (status = 'scheduled' AND (scheduled_for IS NULL OR scheduled_for <= ?))
       OR (status = 'processing' AND (processing_lease_until IS NULL OR processing_lease_until <= ?))
    ORDER BY COALESCE(scheduled_for, created_at), id LIMIT ?`).bind(now, now, limit).all<{ id: string; organizationId: string }>();
  const results: Array<{ id: string; status: string; error?: string }> = [];
  for (const row of rows.results) {
    try {
      const batch = await processPayoutBatchById(row.organizationId, row.id);
      results.push({ id: row.id, status: batch?.status ?? 'skipped' });
    } catch (error) { results.push({ id: row.id, status: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }); }
  }
  return results;
}

function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

export async function payoutBatchResultCsv(organizationId: string, batchId: string) {
  const batch = await retrievePayoutBatch(organizationId, batchId);
  if (!batch) return null;
  const rows = [['batch_reference', 'item_reference', 'beneficiary_reference', 'beneficiary_name', 'destination_type', 'destination_last4',
    'amount_minor', 'currency', 'status', 'transaction_id', 'failure_code', 'failure_message', 'processed_at']];
  for (const item of batch.items) rows.push([batch.externalReference, item.externalReference, item.beneficiaryReference, item.beneficiaryName,
    item.destinationType, item.destinationLast4, item.amountMinor, item.currency, item.status, item.transactionId ?? '', item.failureCode ?? '',
    item.failureMessage ?? '', item.processedAt ?? '']);
  return { fileName: `cimbra-payout-${batch.externalReference}.csv`, csv: `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n` };
}
