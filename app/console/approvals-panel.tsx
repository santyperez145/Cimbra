'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Role = 'owner' | 'admin' | 'operator' | 'viewer';
type ApprovalActionType = 'settlement.execute' | 'transfer.create';
type ApprovalStatus = 'pending' | 'executed' | 'rejected' | 'cancelled' | 'expired' | 'failed';
type Approval = {
  id: string; actionType: ApprovalActionType; resourceType: 'settlement_cycle' | 'transfer'; resourceId: string; status: ApprovalStatus;
  requestPayload: { name?: string; rail?: string; currency?: string; netMinor?: string; amountMinor?: string; differenceMinor?: string;
    executionMode?: string; counterparty?: string; description?: string; origin?: string };
  requestedBy: string; requestedByName: string; resolvedBy: string | null; resolvedByName: string | null;
  resolutionReason: string | null; expiresAt: string; resolvedAt: string | null; executedAt: string | null; createdAt: string;
};
type Policy = { id: string | null; actionType: ApprovalActionType; enabled: boolean; expiresInMinutes: number; eligibleApprovers: number };

const statusLabels: Record<ApprovalStatus, string> = {
  pending: 'Pendiente', executed: 'Ejecutada', rejected: 'Rechazada', cancelled: 'Cancelada', expired: 'Vencida', failed: 'Fallida',
};

const policyLabels: Record<ApprovalActionType, { title: string; direct: string }> = {
  'settlement.execute': { title: 'Ejecución de settlement', direct: 'Ejecución directa sandbox' },
  'transfer.create': { title: 'Transferencias salientes', direct: 'Transferencia directa según riesgo' },
};

function amountLabel(payload: Approval['requestPayload']) {
  const storedAmount = payload.netMinor ?? payload.amountMinor;
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
  return item.actionType === 'transfer.create' ? item.requestPayload.counterparty ?? 'Nueva transferencia' : item.requestPayload.name ?? 'Ejecución de settlement';
}

function approvalChannel(item: Approval) {
  if (item.actionType === 'transfer.create') return `${item.requestPayload.description ?? 'Sin concepto'} · ${item.requestPayload.origin === 'api_key' ? 'API key' : 'consola'}`;
  return item.requestPayload.rail ?? 'rail';
}

function apiError(body: { error?: { message?: string } | string }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

export default function ApprovalsPanel({ actorRole, mfaEnabled }: { actorRole: Role; mfaEnabled: boolean }) {
  const [approvals, setApprovals] = useState<Approval[]>([]); const [policies, setPolicies] = useState<Policy[]>([]);
  const [currentUserId, setCurrentUserId] = useState(''); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const pending = useMemo(() => approvals.filter((item) => item.status === 'pending'), [approvals]);

  const load = useCallback(async () => {
    const approvalResponse = await fetch('/api/v1/approvals', { cache: 'no-store' });
    const approvalResult = await approvalResponse.json() as { data?: Approval[]; meta?: { currentUserId: string }; error?: { message?: string } | string };
    if (!approvalResponse.ok) return setFeedback(apiError(approvalResult));
    setApprovals(approvalResult.data ?? []); setCurrentUserId(approvalResult.meta?.currentUserId ?? '');
    const policyResponse = await fetch('/api/platform/approval-policy', { cache: 'no-store' });
    const policyResult = await policyResponse.json() as { data?: Policy; policies?: Policy[]; error?: string };
    if (!policyResponse.ok) return setFeedback(policyResult.error ?? 'No pudimos cargar la política.');
    setPolicies(policyResult.policies ?? (policyResult.data ? [policyResult.data] : []));
  }, []);

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);

  async function updatePolicy(policy: Policy, enabled: boolean) {
    if (!window.confirm(`${enabled ? 'Habilitar' : 'Deshabilitar'} doble aprobación para ${policyLabels[policy.actionType].title.toLowerCase()}?`)) return;
    setBusy(true); setFeedback('');
    const response = await fetch('/api/platform/approval-policy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: policy.actionType, enabled, expiresInMinutes: policy.expiresInMinutes }) });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? `Doble aprobación ${enabled ? 'habilitada' : 'deshabilitada'} para ${policyLabels[policy.actionType].title.toLowerCase()}.` : result.error ?? 'No pudimos actualizar la política.');
    if (response.ok) await load(); setBusy(false);
  }

  async function decide(item: Approval, decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? window.prompt('Motivo del rechazo (obligatorio):') : 'Revisión de doble control completada.';
    if (reason === null || decision === 'reject' && reason.trim().length < 3) return;
    setBusy(true); setFeedback('');
    const response = await fetch(`/api/v1/approvals/${item.id}/${decision}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ reason }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? decision === 'approve' ? 'Solicitud aprobada y operación ejecutada atómicamente.' : 'Solicitud rechazada.' : apiError(result));
    await load(); setBusy(false);
  }

  async function cancel(item: Approval) {
    if (!window.confirm('¿Cancelar esta solicitud pendiente? El historial se conserva.')) return;
    setBusy(true); setFeedback('');
    const response = await fetch(`/api/v1/approvals/${item.id}/cancel`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ reason: 'Cancelada por el maker.' }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Solicitud cancelada; la operación no se ejecutó.' : apiError(result));
    if (response.ok) await load(); setBusy(false);
  }

  return <div className="module-view approvals-console">
    <div className="module-view-head"><div><p>MAKER / CHECKER</p><h1>Solicitudes y aprobaciones</h1><span>Doble control para operaciones sensibles, con ejecución atómica y trazabilidad.</span></div><span className="module-health"><i /> {pending.length} pendientes</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{pending.length}</strong><span>pendientes</span></article><article><strong>{approvals.filter((item) => item.status === 'executed').length}</strong><span>ejecutadas</span></article><article><strong>{approvals.filter((item) => item.status === 'rejected').length}</strong><span>rechazadas</span></article></div>
    <div className="approval-layout">{policies.map((policy) => <article className="integration-card" key={policy.actionType}><div className="card-head"><div><h2>{policyLabels[policy.actionType].title}</h2><p>El maker solicita; otro owner/admin con MFA decide</p></div><b>{policy.enabled ? 'ACTIVA' : 'OPT-IN'}</b></div>
      {actorRole === 'owner' || actorRole === 'admin' ? <div className="approval-policy-body"><div><span>Estado efectivo</span><strong>{policy.enabled ? 'Doble aprobación obligatoria' : policyLabels[policy.actionType].direct}</strong></div><div><span>Vencimiento</span><strong>{Math.round(policy.expiresInMinutes / 60)} horas</strong></div><div><span>Aprobadores elegibles</span><strong>{policy.eligibleApprovers} con MFA</strong></div>{actorRole === 'owner' ? <button disabled={busy || !mfaEnabled} onClick={() => void updatePolicy(policy, !policy.enabled)}>{!mfaEnabled ? 'Activá MFA para administrar' : policy.enabled ? 'Deshabilitar política' : 'Habilitar doble aprobación'}</button> : <small>Sólo el owner puede cambiar esta política.</small>}</div>
        : <p className="role-boundary-copy">La política es gobernada por el owner. Tu rol puede consultar la cola y originar solicitudes desde las superficies habilitadas.</p>}
    </article>)}<article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Separación efectiva</h2><p>Controles activos del workflow</p></div><b>4-EYES</b></div><div className="approval-guardrails"><span>✓ Maker y checker siempre distintos</span><span>✓ Aprobación reservada a owner/admin con MFA</span><span>✓ Decisión y operación en una sola transacción</span><span>✓ Riesgo vuelve a validar transferencias al aprobar</span><span>✓ Rechazo, cancelación, fallo y vencimiento auditados</span></div></article></div>
    <article className="module-list approval-list"><div className="card-head"><div><h2>Historial de solicitudes</h2><p>Estados persistidos y contexto de la operación</p></div><b>{approvals.length}</b></div>{approvals.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin solicitudes<small>Las transferencias o settlements protegidos aparecerán aquí</small></b></span><strong>Vacío</strong></div> : approvals.map((item) => {
      const canDecide = item.status === 'pending' && item.requestedBy !== currentUserId && (actorRole === 'owner' || actorRole === 'admin') && mfaEnabled;
      const canCancel = item.status === 'pending' && item.requestedBy === currentUserId && actorRole !== 'viewer';
      return <div key={item.id}><span className="movement"><i>{item.actionType === 'transfer.create' ? '↗' : '⇄'}</i><b>{approvalTitle(item)}<small>{amountLabel(item.requestPayload)} · {approvalChannel(item)} · maker {item.requestedByName} · vence {new Date(item.expiresAt).toLocaleString('es-AR')}{item.resolvedByName ? ` · decidió ${item.resolvedByName}` : ''}{item.resolutionReason ? ` · ${item.resolutionReason}` : ''}</small></b></span><span className="approval-actions"><b className={item.status}>{statusLabels[item.status]}</b>{canDecide && <><button className="reject" disabled={busy} onClick={() => void decide(item, 'reject')}>Rechazar</button><button disabled={busy} onClick={() => void decide(item, 'approve')}>Aprobar y ejecutar</button></>}{canCancel && <button className="cancel" disabled={busy} onClick={() => void cancel(item)}>Cancelar</button>}{item.status === 'pending' && item.requestedBy === currentUserId && <small>Esperando otro aprobador</small>}{item.status === 'pending' && !mfaEnabled && (actorRole === 'owner' || actorRole === 'admin') && item.requestedBy !== currentUserId && <small>MFA requerido</small>}</span></div>;
    })}</article>
  </div>;
}
