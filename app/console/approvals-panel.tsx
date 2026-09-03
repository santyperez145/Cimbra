'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Role = OrganizationRole;
type ApprovalActionType = 'settlement.execute' | 'transfer.create' | 'transfer.reverse' | 'payment.create' | 'payment.reverse' | 'bill_payment.create' | 'bill_payment.reverse' | 'instant_transfer.create' | 'instant_transfer.return' | 'collection.refund' | 'recurring_mandate.create' | 'recurring_mandate.resume' | 'debit_request.accept' | 'payment_qr.pay' | 'echeq.deposit' | 'payout_batch.execute' | 'risk.case.resolve' | 'reconciliation.exception.resolve' | 'dispute.resolve';
type ApprovalStatus = 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed';
type Approval = {
  id: string; actionType: ApprovalActionType;
  resourceType: 'settlement_cycle' | 'transfer' | 'book_transfer' | 'payment' | 'bill_payment' | 'instant_transfer' | 'payment_link' | 'payment_qr' | 'echeq' | 'recurring_payment_mandate' | 'payout_batch' | 'risk_case' | 'reconciliation_exception' | 'dispute'; resourceId: string; status: ApprovalStatus;
  requestPayload: { name?: string; rail?: string; currency?: string; netMinor?: string; amountMinor?: string; differenceMinor?: string;
    executionMode?: string; counterparty?: string; description?: string; origin?: string; resolution?: string; note?: string;
    accountId?: string; direction?: 'cash_in' | 'cash_out' | string; paymentId?: string; billerId?: string; orderId?: string;
    externalReference?: string; sourceAccountId?: string; destinationAccountId?: string; bookTransfer?: boolean;
    itemCount?: number; runName?: string; priority?: string; score?: number; reason?: string; creditStatus?: string;
    destinationReferenceLast4?: string; amount?: string; transferId?: string; linkId?: string; counterpartyLast4?: string;
    scheme?: string; creditId?: string | null; collectedMinor?: string; frequency?: string; amountLimit?: string;
    nextChargeAt?: string; consentReference?: string; maxRetries?: number; mandateId?: string; subscriberReferenceLast4?: string;
    debitId?: string; qrId?: string; kind?: string; qrAmountMinor?: string | null; echeqId?: string; beneficiaryName?: string;
    beneficiaryTaxLast4?: string; taxIdLast4?: string; paymentDate?: string };
  requestedBy: string; requestedByName: string; resolvedBy: string | null; resolvedByName: string | null;
  resolutionReason: string | null; expiresAt: string; resolvedAt: string | null; executedAt: string | null; createdAt: string;
};
type Policy = { id: string | null; actionType: ApprovalActionType; enabled: boolean; expiresInMinutes: number; eligibleApprovers: number };

const statusLabels: Record<ApprovalStatus, string> = {
  pending: 'Pendiente', executed: 'Ejecutada', rejected: 'Rechazada', cancelled: 'Cancelada', expired: 'Vencida', failed: 'Fallida',
};

const policyLabels: Record<ApprovalActionType, { title: string; direct: string }> = {
  'settlement.execute': { title: 'Ejecución de settlement', direct: 'Ejecución directa sandbox' },
  'transfer.create': { title: 'Transferencias y book transfers', direct: 'Ejecución directa según saldo y riesgo' },
  'transfer.reverse': { title: 'Reversa de transferencias y book transfers', direct: 'Compensación directa en ledger' },
  'payment.create': { title: 'Cash-in y cash-out', direct: 'Ejecución directa contra settlement interno' },
  'payment.reverse': { title: 'Reversa de cash-in/out', direct: 'Compensación directa en ledger' },
  'bill_payment.create': { title: 'Pagos de servicios y recargas', direct: 'Ejecución directa ledger-backed' },
  'bill_payment.reverse': { title: 'Reversa de pagos de servicios', direct: 'Compensación directa en ledger' },
  'instant_transfer.return': { title: 'Devolución de transferencias instantáneas', direct: 'Compensación directa en ledger' },
  'instant_transfer.create': { title: 'Alta de transferencias instantáneas', direct: 'Ejecución directa en riel sandbox' },
  'collection.refund': { title: 'Devolución de cobranzas', direct: 'Compensación directa en ledger' },
  'recurring_mandate.create': { title: 'Alta de mandatos recurrentes', direct: 'Alta directa con consentimiento declarado' },
  'recurring_mandate.resume': { title: 'Reanudación de mandatos', direct: 'Reactivación directa de cargos programados' },
  'debit_request.accept': { title: 'Aceptación de débitos internos', direct: 'Liquidación directa debit-pull sandbox' },
  'payment_qr.pay': { title: 'Pago de QR Cimbra', direct: 'Cobro directo entre cuentas del tenant' },
  'echeq.deposit': { title: 'Depósito de ECHEQ', direct: 'Acreditación directa en ledger sandbox' },
  'payout_batch.execute': { title: 'Ejecución de lotes de payouts', direct: 'Envío asíncrono por ítem' },
  'risk.case.resolve': { title: 'Resolución de casos de riesgo', direct: 'Resolución directa por operador' },
  'reconciliation.exception.resolve': { title: 'Resolución de excepciones', direct: 'Resolución directa por operador' },
  'dispute.resolve': { title: 'Lifecycle de disputas', direct: 'Transición directa por operador' },
};

function amountLabel(payload: Approval['requestPayload']) {
  const storedAmount = payload.netMinor ?? payload.amountMinor ?? payload.differenceMinor;
  if (!payload.currency || storedAmount === undefined) return 'Importe no disponible';
  const scale = payload.currency === 'CLP' ? 0 : 2;
  try {
    const amount = BigInt(storedAmount); const divisor = 10n ** BigInt(scale); const absolute = amount < 0n ? -amount : amount;
    const whole = (absolute / divisor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const fraction = scale ? `,${(absolute % divisor).toString().padStart(scale, '0')}` : '';
    return `${amount < 0n ? '-' : ''}${payload.currency} ${whole}${fraction}`;
  } catch { return `${payload.currency} ${storedAmount}`; }
}

function approvalTitle(item: Approval) {
  if (item.actionType === 'instant_transfer.create') {
    return `IP · ${item.requestPayload.description ?? item.requestPayload.externalReference ?? item.resourceId}`;
  }
  if (item.actionType === 'instant_transfer.return') {
    return `Devolución IP · ${item.requestPayload.description ?? item.requestPayload.transferId ?? item.resourceId}`;
  }
  if (item.actionType === 'collection.refund') {
    return `Devolución cobro · ${item.requestPayload.externalReference ?? item.requestPayload.linkId ?? item.resourceId}`;
  }
  if (item.actionType === 'recurring_mandate.create') {
    return `Mandato · ${item.requestPayload.billerId ?? item.resourceId}`;
  }
  if (item.actionType === 'recurring_mandate.resume') {
    return `Reanudar · ${item.requestPayload.mandateId ?? item.resourceId}`;
  }
  if (item.actionType === 'debit_request.accept') {
    return `Débito · ${item.requestPayload.description ?? item.requestPayload.externalReference ?? item.resourceId}`;
  }
  if (item.actionType === 'payment_qr.pay') {
    return `QR · ${item.requestPayload.description ?? item.requestPayload.externalReference ?? item.resourceId}`;
  }
  if (item.actionType === 'echeq.deposit') {
    return `ECHEQ · ${item.requestPayload.externalReference ?? item.requestPayload.beneficiaryName ?? item.resourceId}`;
  }
  if (item.actionType === 'bill_payment.create') return `Servicio · ${item.requestPayload.billerId ?? 'orden'}`;
  if (item.actionType === 'bill_payment.reverse') return `Reversa servicio · ${item.requestPayload.orderId ?? item.resourceId}`;
  if (item.actionType === 'transfer.reverse' && item.resourceType === 'book_transfer') {
    return `Reversa book · ${item.requestPayload.externalReference ?? 'book transfer'}`;
  }
  if (item.actionType === 'transfer.reverse') {
    return `Reversa · ${item.requestPayload.counterparty ?? 'transferencia'}`;
  }
  if (item.resourceType === 'book_transfer') return item.requestPayload.externalReference ?? 'Nuevo book transfer';
  if (item.actionType === 'payment.create') {
    return `${item.requestPayload.direction === 'cash_out' ? 'Cash-out' : 'Cash-in'} · ${item.requestPayload.counterparty ?? 'payment'}`;
  }
  if (item.actionType === 'payment.reverse') {
    return `Reversa · ${item.requestPayload.direction === 'cash_out' ? 'cash-out' : 'cash-in'} · ${item.requestPayload.counterparty ?? 'payment'}`;
  }
  if (item.actionType === 'transfer.create') return item.requestPayload.counterparty ?? 'Nueva transferencia';
  if (item.actionType === 'payout_batch.execute') return item.requestPayload.externalReference ?? 'Lote de payouts';
  if (item.actionType === 'risk.case.resolve') return item.requestPayload.counterparty ?? 'Caso de riesgo';
  if (item.actionType === 'reconciliation.exception.resolve') return item.requestPayload.externalReference ?? 'Excepción de conciliación';
  if (item.actionType === 'dispute.resolve') return item.requestPayload.counterparty ?? 'Disputa';
  return item.requestPayload.name ?? 'Ejecución de settlement';
}

function approvalChannel(item: Approval) {
  if (item.actionType === 'instant_transfer.create') {
    return `${item.requestPayload.direction ?? 'outbound'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'instant_transfer.return') {
    return `${item.requestPayload.scheme ?? 'credit_push'} · ${item.requestPayload.direction ?? 'transfer'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'collection.refund') {
    return `${item.requestPayload.description ?? 'Sin concepto'} · compensación cobro · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'recurring_mandate.create') {
    return `${item.requestPayload.frequency ?? 'cadencia'} · límite ${item.requestPayload.amountLimit ?? '—'} · próxima ${item.requestPayload.nextChargeAt ? new Date(item.requestPayload.nextChargeAt).toLocaleString('es-AR') : '—'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'recurring_mandate.resume') {
    return `${item.requestPayload.frequency ?? 'cadencia'} · •••• ${item.requestPayload.subscriberReferenceLast4 ?? '----'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'debit_request.accept') {
    return `${item.requestPayload.externalReference ?? 'débito'} · accept · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'payment_qr.pay') {
    return `${item.requestPayload.kind ?? 'qr'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'echeq.deposit') {
    return `${item.requestPayload.beneficiaryName ?? 'beneficiario'} · •••• ${item.requestPayload.taxIdLast4 ?? item.requestPayload.beneficiaryTaxLast4 ?? '----'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'bill_payment.create' || item.actionType === 'bill_payment.reverse') {
    return `${item.requestPayload.destinationReferenceLast4 ? `•••• ${item.requestPayload.destinationReferenceLast4}` : 'servicio'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'transfer.reverse' && item.resourceType === 'book_transfer') {
    return `${item.requestPayload.description ?? 'Sin concepto'} · compensación book · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'transfer.reverse') {
    return `${item.requestPayload.description ?? 'Sin concepto'} · compensación · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.resourceType === 'book_transfer') return `${item.requestPayload.description ?? 'Sin concepto'} · account-to-account · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  if (item.actionType === 'payment.create') {
    return `${item.requestPayload.description ?? 'Sin concepto'} · ${item.requestPayload.direction ?? 'cash'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'payment.reverse') {
    return `${item.requestPayload.description ?? 'Sin concepto'} · compensación · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  }
  if (item.actionType === 'transfer.create') return `${item.requestPayload.description ?? 'Sin concepto'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  if (item.actionType === 'payout_batch.execute') return `${item.requestPayload.itemCount ?? 0} ítems · ejecución asíncrona`;
  if (item.actionType === 'risk.case.resolve') return `${item.requestPayload.resolution === 'approved' ? 'aprobar' : 'rechazar'} · score ${item.requestPayload.score ?? '—'} · ${item.requestPayload.priority ?? 'sin prioridad'}`;
  if (item.actionType === 'reconciliation.exception.resolve') return `${item.requestPayload.resolution === 'accepted' ? 'aceptar diferencia' : 'marcar corregida'} · ${item.requestPayload.runName ?? 'corrida'}`;
  if (item.actionType === 'dispute.resolve') return `${item.requestPayload.resolution ?? 'transición'} · ${item.requestPayload.reason ?? 'disputa'} · ${item.requestPayload.creditStatus ?? 'sin crédito'}`;
  return item.requestPayload.rail ?? 'rail';
}

function approvalIcon(item: Approval) {
  if (item.actionType === 'bill_payment.create') return '⌁';
  if (item.actionType === 'recurring_mandate.create') return '↻';
  if (item.actionType === 'recurring_mandate.resume') return '▶';
  if (item.actionType === 'instant_transfer.create') return '↗';
  if (item.actionType === 'debit_request.accept') return '↓';
  if (item.actionType === 'payment_qr.pay') return '▣';
  if (item.actionType === 'echeq.deposit') return '◫';
  if (item.actionType === 'bill_payment.reverse' || item.actionType === 'transfer.reverse' || item.actionType === 'payment.reverse'
    || item.actionType === 'instant_transfer.return' || item.actionType === 'collection.refund') return '↺';
  if (item.resourceType === 'book_transfer') return '⇄';
  if (item.actionType === 'payment.create') return item.requestPayload.direction === 'cash_out' ? '↗' : '↙';
  if (item.actionType === 'transfer.create') return '↗';
  if (item.actionType === 'payout_batch.execute') return '≡';
  if (item.actionType === 'risk.case.resolve') return '!';
  if (item.actionType === 'reconciliation.exception.resolve') return '≠';
  if (item.actionType === 'dispute.resolve') return '◫';
  return '⇄';
}

function apiError(body: { error?: { message?: string } | string }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

export default function ApprovalsPanel({ actorRole, mfaEnabled }: { actorRole: Role; mfaEnabled: boolean }) {
  const [approvals, setApprovals] = useState<Approval[]>([]); const [policies, setPolicies] = useState<Policy[]>([]);
  const [currentUserId, setCurrentUserId] = useState(''); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const pending = useMemo(() => approvals.filter((item) => item.status === 'pending'), [approvals]);

  const load = useCallback(async () => {
    const approvalResponse = await authenticatedFetch('/api/v1/approvals', { cache: 'no-store' });
    const approvalResult = await approvalResponse.json() as { data?: Approval[]; meta?: { currentUserId: string }; error?: { message?: string } | string };
    if (!approvalResponse.ok) return setFeedback(apiError(approvalResult));
    setApprovals(approvalResult.data ?? []); setCurrentUserId(approvalResult.meta?.currentUserId ?? '');
    const policyResponse = await authenticatedFetch('/api/platform/approval-policy', { cache: 'no-store' });
    const policyResult = await policyResponse.json() as { data?: Policy; policies?: Policy[]; error?: string };
    if (!policyResponse.ok) return setFeedback(policyResult.error ?? 'No pudimos cargar la política.');
    setPolicies(policyResult.policies ?? (policyResult.data ? [policyResult.data] : []));
  }, []);

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);

  async function updatePolicy(policy: Policy, enabled: boolean) {
    if (!window.confirm(`${enabled ? 'Habilitar' : 'Deshabilitar'} doble aprobación para ${policyLabels[policy.actionType].title.toLowerCase()}?`)) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/platform/approval-policy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: policy.actionType, enabled, expiresInMinutes: policy.expiresInMinutes }) });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? `Doble aprobación ${enabled ? 'habilitada' : 'deshabilitada'} para ${policyLabels[policy.actionType].title.toLowerCase()}.` : result.error ?? 'No pudimos actualizar la política.');
    if (response.ok) await load(); setBusy(false);
  }

  async function decide(item: Approval, decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? window.prompt('Motivo del rechazo (obligatorio):') : 'Revisión de doble control completada.';
    if (reason === null || decision === 'reject' && reason.trim().length < 3) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/approvals/${item.id}/${decision}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ reason }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? decision === 'approve' ? 'Solicitud aprobada y operación ejecutada atómicamente.' : 'Solicitud rechazada.' : apiError(result));
    await load(); setBusy(false);
  }

  async function cancel(item: Approval) {
    if (!window.confirm('¿Cancelar esta solicitud pendiente? El historial se conserva.')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/approvals/${item.id}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ reason: 'Cancelada por el maker.' }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Solicitud cancelada; la operación no se ejecutó.' : apiError(result));
    if (response.ok) await load(); setBusy(false);
  }

  return <div className="module-view approvals-console">
    <div className="module-view-head"><div><p>MAKER / CHECKER</p><h1>Solicitudes y aprobaciones</h1><span>Doble control para operaciones sensibles, con autorización atómica y trazabilidad.</span></div><span className="module-health"><i /> {pending.length} pendientes</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{pending.length}</strong><span>pendientes</span></article><article><strong>{approvals.filter((item) => item.status === 'executed').length}</strong><span>ejecutadas</span></article><article><strong>{approvals.filter((item) => item.status === 'rejected').length}</strong><span>rechazadas</span></article></div>
    <div className="approval-layout">{policies.map((policy) => <article className="integration-card" key={policy.actionType}><div className="card-head"><div><h2>{policyLabels[policy.actionType].title}</h2><p>El maker solicita; otro owner/admin con MFA decide</p></div><b>{policy.enabled ? 'ACTIVA' : 'OPT-IN'}</b></div>
      {roleCan(actorRole, 'approvals.decide') ? <div className="approval-policy-body"><div><span>Estado efectivo</span><strong>{policy.enabled ? 'Doble aprobación obligatoria' : policyLabels[policy.actionType].direct}</strong></div><div><span>Vencimiento</span><strong>{Math.round(policy.expiresInMinutes / 60)} horas</strong></div><div><span>Aprobadores elegibles</span><strong>{policy.eligibleApprovers} con MFA</strong></div>{roleCan(actorRole, 'approvals.policy.manage') ? <button disabled={busy || !mfaEnabled} onClick={() => void updatePolicy(policy, !policy.enabled)}>{!mfaEnabled ? 'Activá MFA para administrar' : policy.enabled ? 'Deshabilitar política' : 'Habilitar doble aprobación'}</button> : <small>Sólo el owner puede cambiar esta política.</small>}</div>
        : <p className="role-boundary-copy">La política es gobernada por el owner. Tu rol puede consultar la cola y originar solicitudes desde las superficies habilitadas.</p>}
    </article>)}<article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Separación efectiva</h2><p>Controles activos del workflow</p></div><b>4-EYES</b></div><div className="approval-guardrails"><span>✓ Maker y checker siempre distintos</span><span>✓ Aprobación reservada a owner/admin con MFA</span><span>✓ Decisión y autorización en una sola transacción</span><span>✓ Transferencias, lotes, casos y diferencias se revalidan al aprobar</span><span>✓ Holds vinculados no permiten saltear la política de riesgo</span><span>✓ Rechazo, cancelación, fallo y vencimiento auditados</span></div></article></div>
    <article className="module-list approval-list"><div className="card-head"><div><h2>Historial de solicitudes</h2><p>Estados persistidos y contexto de la operación</p></div><b>{approvals.length}</b></div>{approvals.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin solicitudes<small>Las operaciones y decisiones protegidas aparecerán aquí</small></b></span><strong>Vacío</strong></div> : approvals.map((item) => {
      const canDecide = item.status === 'pending' && item.requestedBy !== currentUserId && roleCan(actorRole, 'approvals.decide') && mfaEnabled;
      const canCancel = item.status === 'pending' && item.requestedBy === currentUserId && roleCan(actorRole, 'approvals.request');
      return <div key={item.id}><span className="movement"><i>{approvalIcon(item)}</i><b>{approvalTitle(item)}<small>{amountLabel(item.requestPayload)} · {approvalChannel(item)} · maker {item.requestedByName} · vence {new Date(item.expiresAt).toLocaleString('es-AR')}{item.resolvedByName ? ` · decidió ${item.resolvedByName}` : ''}{item.resolutionReason ? ` · ${item.resolutionReason}` : ''}</small></b></span><span className="approval-actions"><b className={item.status}>{statusLabels[item.status]}</b>{canDecide && <><button className="reject" disabled={busy} onClick={() => void decide(item, 'reject')}>Rechazar</button><button disabled={busy} onClick={() => void decide(item, 'approve')}>Aprobar y ejecutar</button></>}{canCancel && <button className="cancel" disabled={busy} onClick={() => void cancel(item)}>Cancelar</button>}{item.status === 'pending' && item.requestedBy === currentUserId && <small>Esperando otro aprobador</small>}{item.status === 'pending' && !mfaEnabled && roleCan(actorRole, 'approvals.decide') && item.requestedBy !== currentUserId && <small>MFA requerido</small>}</span></div>;
    })}</article>
  </div>;
}
