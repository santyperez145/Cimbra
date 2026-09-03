import { sha256 } from '@/app/lib/auth/crypto';
import type { AuthUser } from '@/app/lib/auth/types';
import { majorToMinor, minorToMajorNumber, type Currency } from '@/app/lib/ledger/money';
import type { BillerAmountMode, BillerCategory, BillerServiceType, RecurringFrequency } from '@/app/lib/platform/billers-input';
import { type DatabaseClient, getDatabaseClient } from './client';
import { createAccountPaymentInTransaction, LedgerError, reverseTransactionInTransaction } from './ledger';
import { enqueueWebhookEvent } from './platform';
import { assertSandboxLedgerOrCertifiedRail } from './platform-rails';

type BillerRow = {
  id: string; code: string; name: string; country: string; category: BillerCategory; serviceType: BillerServiceType;
  currency: Currency; amountMode: BillerAmountMode; minAmountMinor: string | null; maxAmountMinor: string | null;
  status: 'active' | 'suspended'; contractReference: string | null; createdBy: string; createdByName: string;
  createdAt: string; updatedAt: string; idempotencyKey?: string; requestFingerprint?: string;
};

type ObligationRow = {
  id: string; billerId: string; billerName: string; externalReference: string; subscriberReferenceLast4: string;
  amountMinor: string; currency: Currency; dueAt: string; description: string; status: 'open' | 'paid' | 'cancelled' | 'expired';
  paidAt: string | null; createdByName: string; createdAt: string; updatedAt: string; requestFingerprint?: string;
};

type OrderRow = {
  id: string; billerId: string; billerName: string; accountId: string; accountReference: string;
  obligationId: string | null; mandateId: string | null; transactionId: string | null; reversalTransactionId: string | null;
  serviceType: BillerServiceType; destinationReferenceLast4: string; amountMinor: string; currency: Currency;
  status: 'declined' | 'review' | 'settled' | 'reversed' | 'cancelled'; failureCode: string | null;
  createdByName: string; createdAt: string; updatedAt: string; settledAt: string | null; reversedAt: string | null;
  requestFingerprint?: string;
};

type ObligationPaymentRow = {
  id: string; amountMinor: string; currency: Currency; status: string;
  subscriberReferenceHash: string; subscriberReferenceLast4: string;
};

type MandateRow = {
  id: string; organizationId: string; billerId: string; billerName: string; serviceType: BillerServiceType; currency: Currency;
  accountId: string; accountReference: string; subscriberReferenceHash?: string; subscriberReferenceLast4: string;
  frequency: RecurringFrequency; amountMinor: string | null; amountLimitMinor: string; consentReference: string; consentedAt: string;
  status: 'active' | 'paused' | 'cancelled' | 'expired'; nextChargeAt: string; pendingScheduledFor: string | null; lastExecutedAt: string | null;
  retryCount: number; maxRetries: number; cancelledAt: string | null; createdBy: string; createdByName: string;
  createdAt: string; updatedAt: string; requestFingerprint?: string;
};

export class BillerError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'biller_error') { super(message); }
}

const billerSelect = `SELECT b.id, b.code, b.name, b.country, b.category, b.service_type AS "serviceType", b.currency,
  b.amount_mode AS "amountMode", b.min_amount_minor::text AS "minAmountMinor", b.max_amount_minor::text AS "maxAmountMinor",
  b.idempotency_key AS "idempotencyKey", b.request_fingerprint AS "requestFingerprint", b.status,
  b.contract_reference AS "contractReference", b.created_by AS "createdBy", creator.display_name AS "createdByName",
  b.created_at AS "createdAt", b.updated_at AS "updatedAt" FROM billers b JOIN users creator ON creator.id = b.created_by`;

const obligationSelect = `SELECT o.id, o.biller_id AS "billerId", b.name AS "billerName", o.external_reference AS "externalReference",
  o.subscriber_reference_last4 AS "subscriberReferenceLast4", o.amount_minor::text AS "amountMinor", o.currency, o.due_at AS "dueAt",
  o.description, o.status, o.paid_at AS "paidAt", o.request_fingerprint AS "requestFingerprint", creator.display_name AS "createdByName", o.created_at AS "createdAt",
  o.updated_at AS "updatedAt" FROM biller_obligations o JOIN billers b ON b.id = o.biller_id JOIN users creator ON creator.id = o.created_by`;

const orderSelect = `SELECT p.id, p.biller_id AS "billerId", b.name AS "billerName", p.account_id AS "accountId",
  a.account_reference AS "accountReference", p.obligation_id AS "obligationId", p.mandate_id AS "mandateId",
  p.transaction_id AS "transactionId", p.reversal_transaction_id AS "reversalTransactionId", p.service_type AS "serviceType",
  p.destination_reference_last4 AS "destinationReferenceLast4", p.amount_minor::text AS "amountMinor", p.currency, p.status,
  p.failure_code AS "failureCode", p.request_fingerprint AS "requestFingerprint", creator.display_name AS "createdByName", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  p.settled_at AS "settledAt", p.reversed_at AS "reversedAt" FROM bill_payment_orders p JOIN billers b ON b.id = p.biller_id
  JOIN accounts a ON a.id = p.account_id JOIN users creator ON creator.id = p.created_by`;

const mandateSelect = `SELECT m.id, m.organization_id AS "organizationId", m.biller_id AS "billerId", b.name AS "billerName", b.service_type AS "serviceType", b.currency,
  m.account_id AS "accountId", a.account_reference AS "accountReference", m.subscriber_reference_hash AS "subscriberReferenceHash",
  m.subscriber_reference_last4 AS "subscriberReferenceLast4", m.frequency, m.amount_minor::text AS "amountMinor",
  m.amount_limit_minor::text AS "amountLimitMinor", m.consent_reference AS "consentReference", m.consented_at AS "consentedAt",
  m.status, m.next_charge_at AS "nextChargeAt", m.pending_scheduled_for AS "pendingScheduledFor",
  m.last_executed_at AS "lastExecutedAt", m.retry_count AS "retryCount",
  m.max_retries AS "maxRetries", m.cancelled_at AS "cancelledAt", m.created_by AS "createdBy", creator.display_name AS "createdByName",
  m.request_fingerprint AS "requestFingerprint", m.created_at AS "createdAt", m.updated_at AS "updatedAt" FROM recurring_payment_mandates m JOIN billers b ON b.id = m.biller_id
  JOIN accounts a ON a.id = m.account_id JOIN users creator ON creator.id = m.created_by`;

function publicAmount(minor: string | null, currency: Currency) {
  return minor === null ? null : minorToMajorNumber(BigInt(minor), currency);
}

function publicBiller(row: BillerRow) {
  const { idempotencyKey, requestFingerprint, ...safe } = row;
  void idempotencyKey; void requestFingerprint;
  return { ...safe, minAmount: publicAmount(row.minAmountMinor, row.currency), maxAmount: publicAmount(row.maxAmountMinor, row.currency) };
}

function publicObligation(row: ObligationRow) {
  const { requestFingerprint, ...safe } = row; void requestFingerprint;
  return { ...safe, amount: publicAmount(row.amountMinor, row.currency) };
}

function publicOrder(row: OrderRow) {
  const { requestFingerprint, ...safe } = row; void requestFingerprint;
  return { ...safe, amount: publicAmount(row.amountMinor, row.currency) };
}

function publicMandate(row: MandateRow) {
  const { requestFingerprint, subscriberReferenceHash, organizationId, pendingScheduledFor, ...safe } = row;
  void requestFingerprint; void subscriberReferenceHash; void organizationId; void pendingScheduledFor;
  return { ...safe, amount: publicAmount(row.amountMinor, row.currency), amountLimit: publicAmount(row.amountLimitMinor, row.currency) };
}

async function protectedReference(organizationId: string, canonical: string) {
  return { hash: await sha256(`${organizationId}:biller-reference:${canonical}`), last4: canonical.slice(-4) };
}

async function audit(database: DatabaseClient, input: { organizationId: string; actorId: string; action: string; resourceType: string; resourceId: string; payload?: Record<string, unknown> }) {
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType, input.resourceId, JSON.stringify(input.payload ?? {}), now).run();
  await enqueueWebhookEvent(database, { organizationId: input.organizationId, eventType: input.action, resourceType: input.resourceType, resourceId: input.resourceId, data: input.payload });
}

async function requestFingerprint(value: Record<string, unknown>) { return sha256(JSON.stringify(value)); }

function assertFingerprint(stored: string | undefined, expected: string) {
  if (stored && stored !== expected) throw new BillerError('La Idempotency-Key ya fue usada con otro payload.', 409, 'idempotency_mismatch');
}

export async function listBillers(organizationId: string) {
  const rows = await getDatabaseClient().prepare(`${billerSelect} WHERE b.organization_id = ? ORDER BY b.name, b.id LIMIT 200`)
    .bind(organizationId).all<BillerRow>();
  return rows.results.map(publicBiller);
}

export async function retrieveBiller(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${billerSelect} WHERE b.organization_id = ? AND b.id = ? LIMIT 1`)
    .bind(organizationId, id).first<BillerRow>();
  return row ? publicBiller(row) : null;
}

export async function createBiller(input: {
  organizationId: string; actor: AuthUser; idempotencyKey: string; code: string; name: string; country: string;
  category: BillerCategory; serviceType: BillerServiceType; currency: Currency; amountMode: BillerAmountMode;
  minAmountMinor: bigint | null; maxAmountMinor: bigint | null; contractReference: string | null;
}) {
  const fingerprint = await requestFingerprint({ code: input.code, name: input.name, country: input.country, category: input.category,
    serviceType: input.serviceType, currency: input.currency, amountMode: input.amountMode, minAmountMinor: input.minAmountMinor?.toString() ?? null,
    maxAmountMinor: input.maxAmountMinor?.toString() ?? null, contractReference: input.contractReference });
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:biller:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${billerSelect}
      WHERE b.organization_id = ? AND b.idempotency_key = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<BillerRow>();
    if (existing) { assertFingerprint(existing.requestFingerprint, fingerprint); return { biller: publicBiller(existing), replayed: true }; }
    const duplicate = await database.prepare('SELECT id FROM billers WHERE organization_id = ? AND code = ? LIMIT 1')
      .bind(input.organizationId, input.code).first<{ id: string }>();
    if (duplicate) throw new BillerError('Ya existe un biller con ese código.', 409, 'biller_code_exists');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(`INSERT INTO billers (id, organization_id, idempotency_key, request_fingerprint, code, name, country, category,
      service_type, currency, amount_mode, min_amount_minor, max_amount_minor, status, contract_reference, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .bind(id, input.organizationId, input.idempotencyKey, fingerprint, input.code, input.name, input.country, input.category,
        input.serviceType, input.currency, input.amountMode, input.minAmountMinor?.toString() ?? null, input.maxAmountMinor?.toString() ?? null,
        input.contractReference, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'biller.created', resourceType: 'biller', resourceId: id,
      payload: { code: input.code, serviceType: input.serviceType, country: input.country, status: 'active' } });
    const row = await database.prepare(`${billerSelect} WHERE b.organization_id = ? AND b.id = ?`).bind(input.organizationId, id).first<BillerRow>();
    return { biller: publicBiller(row!), replayed: false };
  });
}

export async function updateBillerStatus(input: { organizationId: string; actor: AuthUser; billerId: string; idempotencyKey: string; action: 'activate' | 'suspend' }) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:biller-status:${input.idempotencyKey}`).first();
    const event = input.action === 'activate' ? 'biller.activated' : 'biller.suspended';
    const replay = await database.prepare(`SELECT resource_id AS id, action FROM audit_events WHERE organization_id = ?
      AND resource_type = 'biller' AND action IN ('biller.activated', 'biller.suspended')
      AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<{ id: string; action: string }>();
    if (replay) {
      if (replay.id !== input.billerId || replay.action !== event) throw new BillerError('La Idempotency-Key ya fue usada con otra transición de biller.', 409, 'idempotency_mismatch');
      const prior = await database.prepare(`${billerSelect} WHERE b.organization_id = ? AND b.id = ?`).bind(input.organizationId, input.billerId).first<BillerRow>();
      return { biller: publicBiller(prior!), replayed: true };
    }
    const row = await database.prepare('SELECT status FROM billers WHERE organization_id = ? AND id = ? FOR UPDATE')
      .bind(input.organizationId, input.billerId).first<{ status: string }>();
    if (!row) throw new BillerError('Biller no encontrado.', 404, 'biller_not_found');
    const status = input.action === 'activate' ? 'active' : 'suspended'; const now = new Date().toISOString();
    if (row.status !== status) await database.prepare('UPDATE billers SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, input.billerId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: event, resourceType: 'biller', resourceId: input.billerId,
      payload: { idempotencyKey: input.idempotencyKey, status } });
    const updated = await database.prepare(`${billerSelect} WHERE b.organization_id = ? AND b.id = ?`).bind(input.organizationId, input.billerId).first<BillerRow>();
    return { biller: publicBiller(updated!), replayed: false };
  });
}

export async function listBillerObligations(organizationId: string, billerId: string, subscriberReference?: string | null) {
  const database = getDatabaseClient();
  const reference = subscriberReference ? await protectedReference(organizationId, subscriberReference) : null;
  const query = `${obligationSelect} WHERE o.organization_id = ? AND o.biller_id = ?${reference ? ' AND o.subscriber_reference_hash = ?' : ''}
    ORDER BY CASE WHEN o.status = 'open' THEN 0 ELSE 1 END, o.due_at, o.id LIMIT 200`;
  const rows = reference ? await database.prepare(query).bind(organizationId, billerId, reference.hash).all<ObligationRow>()
    : await database.prepare(query).bind(organizationId, billerId).all<ObligationRow>();
  return rows.results.map(publicObligation);
}

export async function createBillerObligation(input: { organizationId: string; actor: AuthUser; billerId: string; idempotencyKey: string;
  externalReference: string; subscriberReference: string; amountMinor: bigint; dueAt: string; description: string }) {
  const reference = await protectedReference(input.organizationId, input.subscriberReference);
  const fingerprint = await requestFingerprint({ billerId: input.billerId, externalReference: input.externalReference, subscriberReferenceHash: reference.hash,
    amountMinor: input.amountMinor.toString(), dueAt: input.dueAt, description: input.description });
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:obligation:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${obligationSelect}
      WHERE o.organization_id = ? AND o.idempotency_key = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<ObligationRow>();
    if (existing) { assertFingerprint(existing.requestFingerprint, fingerprint); return { obligation: publicObligation(existing), replayed: true }; }
    const biller = await database.prepare('SELECT id, service_type AS "serviceType", currency, status FROM billers WHERE organization_id = ? AND id = ? FOR SHARE')
      .bind(input.organizationId, input.billerId).first<{ id: string; serviceType: BillerServiceType; currency: Currency; status: string }>();
    if (!biller) throw new BillerError('Biller no encontrado.', 404, 'biller_not_found');
    if (biller.serviceType !== 'bill_payment') throw new BillerError('Sólo un biller de facturas puede emitir obligaciones.', 409, 'biller_service_type_mismatch');
    if (biller.status !== 'active') throw new BillerError('El biller está suspendido.', 409, 'biller_suspended');
    const duplicate = await database.prepare('SELECT id FROM biller_obligations WHERE organization_id = ? AND biller_id = ? AND external_reference = ?')
      .bind(input.organizationId, input.billerId, input.externalReference).first<{ id: string }>();
    if (duplicate) throw new BillerError('La referencia externa ya existe para este biller.', 409, 'obligation_reference_exists');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(`INSERT INTO biller_obligations (id, organization_id, biller_id, idempotency_key, request_fingerprint,
      external_reference, subscriber_reference_hash, subscriber_reference_last4, amount_minor, currency, due_at, description, status,
      created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
      .bind(id, input.organizationId, input.billerId, input.idempotencyKey, fingerprint, input.externalReference, reference.hash, reference.last4,
        input.amountMinor.toString(), biller.currency, input.dueAt, input.description, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'biller.obligation_created',
      resourceType: 'biller_obligation', resourceId: id, payload: { billerId: input.billerId, externalReference: input.externalReference,
        amountMinor: input.amountMinor.toString(), currency: biller.currency, dueAt: input.dueAt } });
    const created = await database.prepare(`${obligationSelect} WHERE o.organization_id = ? AND o.id = ?`).bind(input.organizationId, id).first<ObligationRow>();
    return { obligation: publicObligation(created!), replayed: false };
  });
}

export async function listBillPaymentOrders(organizationId: string) {
  const rows = await getDatabaseClient().prepare(`${orderSelect} WHERE p.organization_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 200`)
    .bind(organizationId).all<OrderRow>();
  return rows.results.map(publicOrder);
}

export async function retrieveBillPaymentOrder(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${orderSelect} WHERE p.organization_id = ? AND p.id = ? LIMIT 1`)
    .bind(organizationId, id).first<OrderRow>();
  return row ? publicOrder(row) : null;
}

type CreateOrderInput = {
  organizationId: string; actor: AuthUser; idempotencyKey: string; accountId: string; billerId: string; obligationId: string | null;
  destinationReference?: string | null; protectedDestination?: { hash: string; last4: string } | null; amount?: unknown; mandateId?: string | null;
  orderId?: string; approvalContext?: { requestId: string; requestedBy: string };
};

export async function createBillPaymentOrderInTransaction(input: CreateOrderInput, database: DatabaseClient) {
  await assertSandboxLedgerOrCertifiedRail('bill_payments', BillerError);
  const fingerprint = await requestFingerprint({ accountId: input.accountId, billerId: input.billerId, obligationId: input.obligationId,
    destinationReference: input.destinationReference ?? null, protectedDestination: input.protectedDestination ?? null,
    amount: input.amount === undefined ? null : String(input.amount), mandateId: input.mandateId ?? null });
  await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:bill-payment:${input.idempotencyKey}`).first();
  const existing = await database.prepare(`${orderSelect}
    WHERE p.organization_id = ? AND p.idempotency_key = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<OrderRow>();
  if (existing) { assertFingerprint(existing.requestFingerprint, fingerprint); return { order: publicOrder(existing), replayed: true }; }
  const biller = await database.prepare(`SELECT id, name, service_type AS "serviceType", currency, amount_mode AS "amountMode",
    min_amount_minor::text AS "minAmountMinor", max_amount_minor::text AS "maxAmountMinor", status FROM billers
    WHERE organization_id = ? AND id = ? FOR SHARE`).bind(input.organizationId, input.billerId).first<{
      id: string; name: string; serviceType: BillerServiceType; currency: Currency; amountMode: BillerAmountMode;
      minAmountMinor: string | null; maxAmountMinor: string | null; status: string;
    }>();
  if (!biller) throw new BillerError('Biller no encontrado.', 404, 'biller_not_found');
  if (biller.status !== 'active') throw new BillerError('El biller está suspendido.', 409, 'biller_suspended');
  let obligation: ObligationPaymentRow | null = null;
  let amountMinor: bigint; let destination: { hash: string; last4: string };
  if (biller.serviceType === 'bill_payment') {
    if (!input.obligationId) throw new BillerError('El pago de factura requiere obligationId.', 400, 'obligation_required');
    obligation = await database.prepare(`SELECT id, amount_minor::text AS "amountMinor", currency, status,
      subscriber_reference_hash AS "subscriberReferenceHash", subscriber_reference_last4 AS "subscriberReferenceLast4"
      FROM biller_obligations WHERE organization_id = ? AND biller_id = ? AND id = ? FOR UPDATE`)
      .bind(input.organizationId, input.billerId, input.obligationId).first<ObligationPaymentRow>();
    if (!obligation) throw new BillerError('Obligación no encontrada.', 404, 'obligation_not_found');
    if (obligation.status !== 'open') throw new BillerError('La obligación ya no está abierta.', 409, 'obligation_not_open');
    const activeOrder = await database.prepare(`SELECT id FROM bill_payment_orders WHERE organization_id = ? AND obligation_id = ?
      AND status IN ('review', 'settled') LIMIT 1`).bind(input.organizationId, obligation.id).first<{ id: string }>();
    if (activeOrder) throw new BillerError('La obligación ya tiene una orden activa.', 409, 'obligation_payment_active');
    amountMinor = BigInt(obligation.amountMinor); destination = { hash: obligation.subscriberReferenceHash, last4: obligation.subscriberReferenceLast4 };
  } else {
    if (input.obligationId) throw new BillerError('Las recargas y gift cards no usan obligaciones.', 400, 'obligation_not_supported');
    destination = input.protectedDestination ?? (input.destinationReference ? await protectedReference(input.organizationId, input.destinationReference) : null)!;
    if (!destination) throw new BillerError('La referencia de destino es obligatoria.', 400, 'destination_reference_required');
    try { amountMinor = majorToMinor(input.amount, biller.currency); } catch (error) {
      throw new BillerError(error instanceof Error ? error.message : 'Monto inválido.', 400, 'invalid_amount');
    }
    if (amountMinor <= 0n || amountMinor > majorToMinor('10000000', biller.currency)) throw new BillerError('Monto fuera de rango.', 400, 'invalid_amount');
    const min = biller.minAmountMinor ? BigInt(biller.minAmountMinor) : null; const max = biller.maxAmountMinor ? BigInt(biller.maxAmountMinor) : null;
    if (min && amountMinor < min || max && amountMinor > max) throw new BillerError('El monto no cumple el rango configurado por el biller.', 422, 'amount_out_of_biller_range');
  }
  const payment = await createAccountPaymentInTransaction({ organizationId: input.organizationId, actor: input.actor,
    idempotencyKey: `bill-order:${input.idempotencyKey}`, accountId: input.accountId, direction: 'cash_out', counterparty: biller.name,
    description: `${biller.serviceType === 'bill_payment' ? 'Pago de servicio' : biller.serviceType === 'mobile_topup' ? 'Recarga' : 'Gift card'} · ${destination.last4}`,
    amountMinor, currency: biller.currency, approvalContext: input.approvalContext }, database);
  const id = input.orderId ?? crypto.randomUUID(); const now = new Date().toISOString();
  const declined = 'declined' in payment; const transactionId = declined ? null : payment.payment.id;
  const status: OrderRow['status'] = declined ? 'declined' : payment.payment.status === 'review' ? 'review' : 'settled';
  await database.prepare(`INSERT INTO bill_payment_orders (id, organization_id, biller_id, account_id, obligation_id, mandate_id,
    transaction_id, idempotency_key, request_fingerprint, service_type, destination_reference_hash, destination_reference_last4,
    amount_minor, currency, status, failure_code, created_by, created_at, updated_at, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.organizationId, input.billerId, input.accountId, obligation?.id ?? null, input.mandateId ?? null, transactionId,
      input.idempotencyKey, fingerprint, biller.serviceType, destination.hash, destination.last4, amountMinor.toString(), biller.currency,
      status, declined ? 'risk_declined' : null, input.actor.userId, now, now, status === 'settled' ? now : null).run();
  if (status === 'settled' && obligation) await database.prepare("UPDATE biller_obligations SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, obligation.id).run();
  await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'bill_payment.created',
    resourceType: 'bill_payment_order', resourceId: id, payload: { billerId: input.billerId, accountId: input.accountId,
      obligationId: obligation?.id ?? null, mandateId: input.mandateId ?? null, amountMinor: amountMinor.toString(), currency: biller.currency, status,
      approvalRequestId: input.approvalContext?.requestId ?? null, requestedBy: input.approvalContext?.requestedBy ?? null } });
  await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: `bill_payment.${status}`,
    resourceType: 'bill_payment_order', resourceId: id, payload: { transactionId, obligationId: obligation?.id ?? null, status } });
  const created = await database.prepare(`${orderSelect} WHERE p.organization_id = ? AND p.id = ?`).bind(input.organizationId, id).first<OrderRow>();
  return { order: publicOrder(created!), replayed: false };
}

export function createBillPaymentOrder(input: CreateOrderInput) {
  return getDatabaseClient().transaction((database) => createBillPaymentOrderInTransaction(input, database));
}

export async function reverseBillPaymentOrder(input: {
  organizationId: string; actor: AuthUser; orderId: string; idempotencyKey: string;
  approvalContext?: { requestId: string; requestedBy: string };
}) {
  return getDatabaseClient().transaction((database) => reverseBillPaymentOrderInTransaction(input, database));
}

export async function reverseBillPaymentOrderInTransaction(input: {
  organizationId: string; actor: AuthUser; orderId: string; idempotencyKey: string;
  approvalContext?: { requestId: string; requestedBy: string };
}, database: DatabaseClient) {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:bill-payment-reverse:${input.idempotencyKey}`).first();
    const replay = await database.prepare(`SELECT resource_id AS id FROM audit_events WHERE organization_id = ? AND action = 'bill_payment.order_reversed'
      AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<{ id: string }>();
    if (replay) {
      if (replay.id !== input.orderId) throw new BillerError('La Idempotency-Key ya fue usada para otra reversa.', 409, 'idempotency_mismatch');
      const prior = await database.prepare(`${orderSelect} WHERE p.organization_id = ? AND p.id = ?`).bind(input.organizationId, input.orderId).first<OrderRow>();
      return { order: publicOrder(prior!), replayed: true };
    }
    const row = await database.prepare(`SELECT id, transaction_id AS "transactionId", obligation_id AS "obligationId", status
      FROM bill_payment_orders WHERE organization_id = ? AND id = ? FOR UPDATE`).bind(input.organizationId, input.orderId)
      .first<{ id: string; transactionId: string | null; obligationId: string | null; status: string }>();
    if (!row) throw new BillerError('Orden de pago no encontrada.', 404, 'bill_payment_not_found');
    if (row.status !== 'settled' || !row.transactionId) throw new BillerError('Sólo una orden liquidada puede revertirse.', 409, 'bill_payment_not_reversible');
    let reversed;
    try { reversed = await reverseTransactionInTransaction({ organizationId: input.organizationId, actor: input.actor,
      transactionId: row.transactionId, idempotencyKey: `bill-order:${input.idempotencyKey}`, auditAction: 'bill_payment.reversed',
      approvalContext: input.approvalContext }, database); }
    catch (error) { if (error instanceof LedgerError) throw new BillerError(error.message, error.status, error.code); throw error; }
    const now = new Date().toISOString();
    await database.prepare("UPDATE bill_payment_orders SET status = 'reversed', reversal_transaction_id = ?, reversed_at = ?, updated_at = ? WHERE id = ?")
      .bind(reversed.transaction.id, now, now, row.id).run();
    if (row.obligationId) {
      await database.prepare("UPDATE biller_obligations SET status = 'open', paid_at = NULL, updated_at = ? WHERE id = ?").bind(now, row.obligationId).run();
      await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'biller.obligation_reopened',
        resourceType: 'biller_obligation', resourceId: row.obligationId, payload: { orderId: row.id, reversalTransactionId: reversed.transaction.id } });
    }
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'bill_payment.order_reversed',
      resourceType: 'bill_payment_order', resourceId: row.id, payload: {
        idempotencyKey: input.idempotencyKey, reversalTransactionId: reversed.transaction.id,
        approvalRequestId: input.approvalContext?.requestId ?? null, requestedBy: input.approvalContext?.requestedBy ?? null,
      } });
    const updated = await database.prepare(`${orderSelect} WHERE p.organization_id = ? AND p.id = ?`).bind(input.organizationId, row.id).first<OrderRow>();
    return { order: publicOrder(updated!), replayed: false };
}

export async function listRecurringMandates(organizationId: string) {
  const rows = await getDatabaseClient().prepare(`${mandateSelect} WHERE m.organization_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 200`)
    .bind(organizationId).all<MandateRow>();
  return rows.results.map(publicMandate);
}

export async function retrieveRecurringMandate(organizationId: string, id: string) {
  const row = await getDatabaseClient().prepare(`${mandateSelect} WHERE m.organization_id = ? AND m.id = ? LIMIT 1`)
    .bind(organizationId, id).first<MandateRow>();
  return row ? publicMandate(row) : null;
}

export async function listRecurringMandateExecutions(organizationId: string, mandateId: string, limit = 50) {
  const mandate = await getDatabaseClient().prepare(
    'SELECT id FROM recurring_payment_mandates WHERE organization_id = ? AND id = ? LIMIT 1',
  ).bind(organizationId, mandateId).first<{ id: string }>();
  if (!mandate) return null;
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = await getDatabaseClient().prepare(
    `SELECT id, mandate_id AS "mandateId", order_id AS "orderId", scheduled_for AS "scheduledFor",
      attempt_number AS "attemptNumber", status, error_code AS "errorCode", attempted_at AS "attemptedAt"
     FROM recurring_payment_executions
     WHERE organization_id = ? AND mandate_id = ?
     ORDER BY attempted_at DESC, attempt_number DESC
     LIMIT ?`,
  ).bind(organizationId, mandateId, capped).all<{
    id: string; mandateId: string; orderId: string | null; scheduledFor: string;
    attemptNumber: number; status: string; errorCode: string | null; attemptedAt: string;
  }>();
  return rows.results;
}

export async function createRecurringMandate(input: { organizationId: string; actor: AuthUser; idempotencyKey: string; accountId: string;
  billerId: string; subscriberReference: string; frequency: RecurringFrequency; amount: unknown; amountLimit: unknown;
  consentReference: string; consentedAt: string; nextChargeAt: string; maxRetries: number }) {
  const reference = await protectedReference(input.organizationId, input.subscriberReference);
  return getDatabaseClient().transaction(async (database) => {
    const biller = await database.prepare(`SELECT service_type AS "serviceType", currency, amount_mode AS "amountMode", min_amount_minor::text AS "minAmountMinor",
      max_amount_minor::text AS "maxAmountMinor", status FROM billers WHERE organization_id = ? AND id = ? FOR SHARE`)
      .bind(input.organizationId, input.billerId).first<{ serviceType: BillerServiceType; currency: Currency; amountMode: BillerAmountMode; minAmountMinor: string | null; maxAmountMinor: string | null; status: string }>();
    if (!biller) throw new BillerError('Biller no encontrado.', 404, 'biller_not_found');
    if (biller.status !== 'active') throw new BillerError('El biller está suspendido.', 409, 'biller_suspended');
    const account = await database.prepare('SELECT currency, status FROM accounts WHERE organization_id = ? AND id = ? FOR SHARE')
      .bind(input.organizationId, input.accountId).first<{ currency: Currency; status: string }>();
    if (!account) throw new BillerError('Cuenta no encontrada.', 404, 'account_not_found');
    if (account.status !== 'active' || account.currency !== biller.currency) throw new BillerError('La cuenta no está activa en la moneda del biller.', 409, 'account_not_eligible');
    let amountLimitMinor: bigint; try { amountLimitMinor = majorToMinor(input.amountLimit, biller.currency); }
    catch { throw new BillerError('Límite de mandato inválido.', 400, 'invalid_amount_limit'); }
    if (amountLimitMinor <= 0n || amountLimitMinor > majorToMinor('10000000', biller.currency)) throw new BillerError('Límite de mandato fuera de rango.', 400, 'invalid_amount_limit');
    let amountMinor: bigint | null = null;
    if (biller.serviceType !== 'bill_payment') {
      try { amountMinor = majorToMinor(input.amount, biller.currency); } catch { throw new BillerError('Monto recurrente inválido.', 400, 'invalid_amount'); }
      if (amountMinor <= 0n || amountMinor > amountLimitMinor) throw new BillerError('El monto recurrente supera el límite autorizado.', 422, 'mandate_amount_exceeds_limit');
      const min = biller.minAmountMinor ? BigInt(biller.minAmountMinor) : null; const max = biller.maxAmountMinor ? BigInt(biller.maxAmountMinor) : null;
      if (min && amountMinor < min || max && amountMinor > max) throw new BillerError('El monto no cumple el rango del biller.', 422, 'amount_out_of_biller_range');
    }
    const fingerprint = await requestFingerprint({ accountId: input.accountId, billerId: input.billerId, subscriberReferenceHash: reference.hash,
      frequency: input.frequency, amountMinor: amountMinor?.toString() ?? null, amountLimitMinor: amountLimitMinor.toString(),
      consentReference: input.consentReference, consentedAt: input.consentedAt, nextChargeAt: input.nextChargeAt, maxRetries: input.maxRetries });
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:mandate:${input.idempotencyKey}`).first();
    const existing = await database.prepare(`${mandateSelect}
      WHERE m.organization_id = ? AND m.idempotency_key = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<MandateRow>();
    if (existing) { assertFingerprint(existing.requestFingerprint, fingerprint); return { mandate: publicMandate(existing), replayed: true }; }
    const duplicateConsent = await database.prepare('SELECT id FROM recurring_payment_mandates WHERE organization_id = ? AND consent_reference = ? LIMIT 1')
      .bind(input.organizationId, input.consentReference).first<{ id: string }>();
    if (duplicateConsent) throw new BillerError('La referencia de consentimiento ya fue utilizada.', 409, 'mandate_consent_exists');
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await database.prepare(`INSERT INTO recurring_payment_mandates (id, organization_id, biller_id, account_id, idempotency_key,
      request_fingerprint, subscriber_reference_hash, subscriber_reference_last4, frequency, amount_minor, amount_limit_minor,
      consent_reference, consented_at, status, next_charge_at, retry_count, max_retries, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)`)
      .bind(id, input.organizationId, input.billerId, input.accountId, input.idempotencyKey, fingerprint, reference.hash, reference.last4,
        input.frequency, amountMinor?.toString() ?? null, amountLimitMinor.toString(), input.consentReference, input.consentedAt,
        input.nextChargeAt, input.maxRetries, input.actor.userId, now, now).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: 'recurring_mandate.created',
      resourceType: 'recurring_payment_mandate', resourceId: id, payload: { billerId: input.billerId, accountId: input.accountId,
        frequency: input.frequency, nextChargeAt: input.nextChargeAt, amountLimitMinor: amountLimitMinor.toString(), currency: biller.currency } });
    const created = await database.prepare(`${mandateSelect} WHERE m.organization_id = ? AND m.id = ?`).bind(input.organizationId, id).first<MandateRow>();
    return { mandate: publicMandate(created!), replayed: false };
  });
}

export async function updateRecurringMandateStatus(input: { organizationId: string; actor: AuthUser; mandateId: string; idempotencyKey: string;
  action: 'pause' | 'resume' | 'cancel' }) {
  return getDatabaseClient().transaction(async (database) => {
    await database.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))').bind(`${input.organizationId}:mandate-status:${input.idempotencyKey}`).first();
    const event = `recurring_mandate.${input.action === 'cancel' ? 'cancelled' : input.action === 'pause' ? 'paused' : 'resumed'}`;
    const replay = await database.prepare(`SELECT resource_id AS id, action FROM audit_events WHERE organization_id = ?
      AND resource_type = 'recurring_payment_mandate'
      AND action IN ('recurring_mandate.paused', 'recurring_mandate.resumed', 'recurring_mandate.cancelled')
      AND payload::jsonb->>'idempotencyKey' = ? LIMIT 1`).bind(input.organizationId, input.idempotencyKey).first<{ id: string; action: string }>();
    if (replay) {
      if (replay.id !== input.mandateId || replay.action !== event) throw new BillerError('La Idempotency-Key ya fue usada con otra transición de mandato.', 409, 'idempotency_mismatch');
      const prior = await database.prepare(`${mandateSelect} WHERE m.organization_id = ? AND m.id = ?`).bind(input.organizationId, input.mandateId).first<MandateRow>();
      return { mandate: publicMandate(prior!), replayed: true };
    }
    const current = await database.prepare('SELECT status, next_charge_at AS "nextChargeAt", retry_count AS "retryCount" FROM recurring_payment_mandates WHERE organization_id = ? AND id = ? FOR UPDATE')
      .bind(input.organizationId, input.mandateId).first<{ status: string; nextChargeAt: string; retryCount: number }>();
    if (!current) throw new BillerError('Mandato no encontrado.', 404, 'mandate_not_found');
    if (['cancelled', 'expired'].includes(current.status)) throw new BillerError('El mandato está en estado terminal.', 409, 'mandate_terminal');
    if (input.action === 'pause' && current.status !== 'active' || input.action === 'resume' && current.status !== 'paused') {
      throw new BillerError('La transición del mandato no es válida.', 409, 'mandate_transition_invalid');
    }
    const status = input.action === 'cancel' ? 'cancelled' : input.action === 'pause' ? 'paused' : 'active'; const now = new Date().toISOString();
    const nextChargeAt = input.action === 'resume' && Date.parse(current.nextChargeAt) < Date.now() ? now : current.nextChargeAt;
    await database.prepare('UPDATE recurring_payment_mandates SET status = ?, next_charge_at = ?, retry_count = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, nextChargeAt, input.action === 'resume' ? 0 : current.retryCount, input.action === 'cancel' ? now : null, now, input.mandateId).run();
    await audit(database, { organizationId: input.organizationId, actorId: input.actor.userId, action: event,
      resourceType: 'recurring_payment_mandate', resourceId: input.mandateId, payload: { idempotencyKey: input.idempotencyKey, status, nextChargeAt } });
    const updated = await database.prepare(`${mandateSelect} WHERE m.organization_id = ? AND m.id = ?`).bind(input.organizationId, input.mandateId).first<MandateRow>();
    return { mandate: publicMandate(updated!), replayed: false };
  });
}

function nextOccurrence(value: string, frequency: RecurringFrequency) {
  const date = new Date(value);
  if (frequency === 'weekly') { date.setUTCDate(date.getUTCDate() + 7); return date.toISOString(); }
  const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export async function processDueRecurringMandates(limit = 50) {
  const database = getDatabaseClient(); const now = new Date().toISOString();
  const due = await database.prepare(`${mandateSelect} WHERE m.status = 'active' AND m.next_charge_at <= ? ORDER BY m.next_charge_at, m.id LIMIT ?`)
    .bind(now, limit).all<MandateRow>();
  const results: Array<{ mandateId: string; status: string; orderId?: string; errorCode?: string }> = [];
  for (const candidate of due.results) {
    const dueAt = candidate.nextChargeAt; const claimedAt = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const claim = await database.transaction(async (transaction) => {
      const mandate = await transaction.prepare(`${mandateSelect} WHERE m.id = ? AND m.organization_id = ? FOR UPDATE`)
        .bind(candidate.id, candidate.organizationId).first<MandateRow>();
      if (!mandate || mandate.status !== 'active' || mandate.nextChargeAt !== dueAt) return null;
      const scheduledFor = mandate.pendingScheduledFor ?? mandate.nextChargeAt;
      await transaction.prepare('UPDATE recurring_payment_mandates SET pending_scheduled_for = ?, next_charge_at = ?, updated_at = ? WHERE id = ?')
        .bind(scheduledFor, leaseUntil, claimedAt, mandate.id).run();
      return { ...mandate, pendingScheduledFor: scheduledFor, nextChargeAt: leaseUntil };
    });
    if (!claim) { results.push({ mandateId: candidate.id, status: 'skipped' }); continue; }
    const executionScheduledFor = claim.pendingScheduledFor!;
    try {
      const result = await database.transaction(async (transaction) => {
        const mandate = await transaction.prepare(`${mandateSelect} WHERE m.id = ? AND m.organization_id = ? FOR UPDATE`)
          .bind(candidate.id, candidate.organizationId).first<MandateRow>();
        if (!mandate || mandate.status !== 'active' || mandate.nextChargeAt !== leaseUntil || mandate.pendingScheduledFor !== executionScheduledFor) {
          return { status: 'skipped' };
        }
        const scheduledFor = mandate.pendingScheduledFor;
        const prior = await transaction.prepare(`SELECT status, order_id AS "orderId" FROM recurring_payment_executions
          WHERE mandate_id = ? AND scheduled_for = ? ORDER BY attempt_number DESC LIMIT 1`)
          .bind(mandate.id, scheduledFor).first<{ status: string; orderId: string | null }>();
        if (prior && prior.status !== 'failed') {
          const nextChargeAt = nextOccurrence(scheduledFor, mandate.frequency);
          await transaction.prepare('UPDATE recurring_payment_mandates SET pending_scheduled_for = NULL, next_charge_at = ?, retry_count = 0, updated_at = ? WHERE id = ?')
            .bind(nextChargeAt, new Date().toISOString(), mandate.id).run();
          return { status: prior.status, orderId: prior.orderId ?? undefined };
        }
        const actorRow = await transaction.prepare(`SELECT id AS "userId", username, display_name AS "displayName", email,
          email_verified AS "emailVerified", mfa_enabled AS "mfaEnabled" FROM users WHERE id = ?`).bind(mandate.createdBy).first<AuthUser>();
        if (!actorRow) throw new BillerError('El actor del mandato ya no existe.', 409, 'mandate_actor_missing');
        let obligationId: string | null = null;
        if (mandate.serviceType === 'bill_payment') {
          const obligation = await transaction.prepare(`SELECT id FROM biller_obligations WHERE organization_id = ? AND biller_id = ?
            AND subscriber_reference_hash = ? AND status = 'open' AND amount_minor <= ? ORDER BY due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`)
            .bind(mandate.organizationId, mandate.billerId, mandate.subscriberReferenceHash!, mandate.amountLimitMinor).first<{ id: string }>();
          if (!obligation) {
            const executionId = crypto.randomUUID(); const attemptedAt = new Date().toISOString(); const nextChargeAt = nextOccurrence(scheduledFor, mandate.frequency);
            await transaction.prepare(`INSERT INTO recurring_payment_executions (id, organization_id, mandate_id, scheduled_for, attempt_number, status, attempted_at)
              VALUES (?, ?, ?, ?, ?, 'skipped_no_debt', ?)`)
              .bind(executionId, mandate.organizationId, mandate.id, scheduledFor, mandate.retryCount + 1, attemptedAt).run();
            await transaction.prepare('UPDATE recurring_payment_mandates SET pending_scheduled_for = NULL, next_charge_at = ?, last_executed_at = ?, retry_count = 0, updated_at = ? WHERE id = ?')
              .bind(nextChargeAt, attemptedAt, attemptedAt, mandate.id).run();
            await audit(transaction, { organizationId: mandate.organizationId,
              actorId: actorRow.userId, action: 'recurring_mandate.execution_skipped', resourceType: 'recurring_payment_mandate', resourceId: mandate.id,
              payload: { scheduledFor, reason: 'no_open_debt', nextChargeAt } });
            return { status: 'skipped_no_debt' };
          }
          obligationId = obligation.id;
        }
        const organizationId = mandate.organizationId;
        const order = await createBillPaymentOrderInTransaction({ organizationId, actor: actorRow, idempotencyKey: `mandate:${mandate.id}:${scheduledFor}`,
          accountId: mandate.accountId, billerId: mandate.billerId, obligationId, protectedDestination: { hash: mandate.subscriberReferenceHash!, last4: mandate.subscriberReferenceLast4 },
          amount: mandate.amountMinor === null ? undefined : publicAmount(mandate.amountMinor, mandate.currency), mandateId: mandate.id }, transaction);
        const status = order.order.status; const attemptedAt = new Date().toISOString(); const nextChargeAt = nextOccurrence(scheduledFor, mandate.frequency);
        await transaction.prepare(`INSERT INTO recurring_payment_executions (id, organization_id, mandate_id, order_id, scheduled_for, attempt_number, status, attempted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), organizationId, mandate.id, order.order.id, scheduledFor, mandate.retryCount + 1, status, attemptedAt).run();
        await transaction.prepare('UPDATE recurring_payment_mandates SET pending_scheduled_for = NULL, next_charge_at = ?, last_executed_at = ?, retry_count = 0, updated_at = ? WHERE id = ?')
          .bind(nextChargeAt, attemptedAt, attemptedAt, mandate.id).run();
        await audit(transaction, { organizationId, actorId: actorRow.userId, action: 'recurring_mandate.execution_completed',
          resourceType: 'recurring_payment_mandate', resourceId: mandate.id, payload: { orderId: order.order.id, scheduledFor, status, nextChargeAt } });
        return { status, orderId: order.order.id };
      });
      results.push({ mandateId: candidate.id, ...result });
    } catch (error) {
      const errorCode = error instanceof BillerError || error instanceof LedgerError ? error.code : 'internal_error';
      await database.transaction(async (transaction) => {
        const mandate = await transaction.prepare(`SELECT organization_id AS "organizationId", retry_count AS "retryCount",
          max_retries AS "maxRetries", status, next_charge_at AS "nextChargeAt", pending_scheduled_for AS "pendingScheduledFor"
          FROM recurring_payment_mandates WHERE id = ? AND organization_id = ? FOR UPDATE`)
          .bind(candidate.id, candidate.organizationId).first<{ organizationId: string; retryCount: number; maxRetries: number;
            status: string; nextChargeAt: string; pendingScheduledFor: string | null }>();
        if (!mandate || mandate.status !== 'active' || mandate.nextChargeAt !== leaseUntil || mandate.pendingScheduledFor !== executionScheduledFor) return;
        const attemptedAt = new Date().toISOString(); const retryCount = mandate.retryCount + 1; const exhausted = retryCount > mandate.maxRetries;
        await transaction.prepare(`INSERT INTO recurring_payment_executions (id, organization_id, mandate_id, scheduled_for, attempt_number, status, error_code, attempted_at)
          VALUES (?, ?, ?, ?, ?, 'failed', ?, ?) ON CONFLICT (mandate_id, scheduled_for, attempt_number) DO NOTHING`)
          .bind(crypto.randomUUID(), mandate.organizationId, candidate.id, executionScheduledFor, retryCount, errorCode, attemptedAt).run();
        await transaction.prepare('UPDATE recurring_payment_mandates SET retry_count = ?, status = ?, next_charge_at = ?, updated_at = ? WHERE id = ?')
          .bind(retryCount, exhausted ? 'paused' : 'active', exhausted ? attemptedAt : new Date(Date.now() + 60 * 60 * 1000).toISOString(), attemptedAt, candidate.id).run();
        await audit(transaction, { organizationId: mandate.organizationId, actorId: candidate.createdBy, action: 'recurring_mandate.execution_failed',
          resourceType: 'recurring_payment_mandate', resourceId: candidate.id, payload: { scheduledFor: executionScheduledFor, errorCode, retryCount, paused: exhausted } });
      });
      results.push({ mandateId: candidate.id, status: 'failed', errorCode });
    }
  }
  return results;
}
