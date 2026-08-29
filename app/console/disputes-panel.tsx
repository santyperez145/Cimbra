'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import type { DisputeEvent, DisputeReason, DisputeStatus } from '@/app/lib/platform/disputes';

type Transaction = { id: string; counterparty: string; description: string; amount: number; disputableAmount: number; currency: string; createdAt: string };
type Dispute = {
  id: string; transactionId: string; reason: DisputeReason; description: string; amount: number; amountMinor: string; currency: string;
  status: DisputeStatus; open: boolean; priority: string; provisionalCreditRequested: boolean;
  creditStatus: 'none' | 'posted' | 'final' | 'reversed'; creditTransactionId: string | null; creditReversalTransactionId: string | null;
  possibleEvents: DisputeEvent[]; dueAt: string | null; openedByName: string; resolvedByName: string | null;
  resolutionNote: string | null; createdAt: string; originalTransaction: Transaction;
};
type TimelineEvent = { id: string; event: string; fromStatus: string | null; toStatus: string; note: string; actorName: string; createdAt: string };
type ListState = { disputes: Dispute[]; eligibleTransactions: Transaction[] };

const empty: ListState = { disputes: [], eligibleTransactions: [] };
const reasonLabels: Record<DisputeReason, string> = {
  card_not_present: 'No reconoce la compra', duplicate: 'Cargo duplicado', amount_mismatch: 'Monto incorrecto',
  service_not_received: 'Servicio no recibido', credit_not_processed: 'Devolución no acreditada',
  cash_not_received: 'Efectivo no recibido', other: 'Otro motivo',
};
const eventLabels: Record<DisputeEvent, string> = {
  start_review: 'Iniciar revisión', mark_network_ready: 'Marcar lista para red', resolve_won: 'Resolver a favor',
  resolve_lost: 'Resolver en contra', reject: 'Rechazar disputa', cancel: 'Cancelar disputa',
};
const statusLabels: Record<DisputeStatus, string> = {
  opened: 'Abierta', under_review: 'En revisión', network_ready: 'Lista para red', won: 'Ganada', lost: 'Perdida', rejected: 'Rechazada', cancelled: 'Cancelada',
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function apiError(value: unknown, fallback: string) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message;
  return fallback;
}

export default function DisputesPanel({ readOnly }: { readOnly: boolean }) {
  const [data, setData] = useState<ListState>(empty); const [selectedId, setSelectedId] = useState('');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(true); const [feedback, setFeedback] = useState('');
  const selected = data.disputes.find((item) => item.id === selectedId) ?? null;

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/disputes', { cache: 'no-store' });
    const result = await response.json() as { data?: ListState; error?: unknown };
    if (response.ok && result.data) {
      setData(result.data); setSelectedId((current) => current && result.data!.disputes.some((item) => item.id === current)
        ? current : result.data!.disputes[0]?.id ?? '');
    } else setFeedback(apiError(result.error, 'No pudimos cargar las disputas.'));
    setBusy(false);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load().catch(() => {
      if (active) { setFeedback('No pudimos conectar con Disputes.'); setBusy(false); }
    }); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void authenticatedFetch(`/api/v1/disputes/${selectedId}`, { cache: 'no-store' }).then(async (response) => {
      const result = await response.json() as { data?: { events: TimelineEvent[] } };
      if (active && response.ok) setTimeline(result.data?.events ?? []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selectedId, data.disputes]);

  const metrics = useMemo(() => ({ open: data.disputes.filter((item) => item.open).length,
    provisional: data.disputes.filter((item) => item.creditStatus === 'posted').length,
    won: data.disputes.filter((item) => item.status === 'won').length }), [data.disputes]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(''); const form = event.currentTarget;
    const values = new FormData(form); const transaction = data.eligibleTransactions.find((item) => item.id === values.get('transactionId'));
    const response = await authenticatedFetch('/api/v1/disputes', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ transactionId: transaction?.id, reason: values.get('reason'), description: values.get('description'),
        amount: values.get('amount'), currency: transaction?.currency, provisionalCreditRequested: values.get('provisionalCredit') === 'on' }) });
    const result = await response.json() as { dispute?: Dispute; error?: unknown };
    if (response.ok) { setFeedback('Disputa abierta; el movimiento original quedó inmutable.'); form.reset(); await load(); if (result.dispute) setSelectedId(result.dispute.id); }
    else { setFeedback(apiError(result.error, 'No pudimos abrir la disputa.')); setBusy(false); }
  }

  async function transition(event: DisputeEvent) {
    if (!selected || note.trim().length < 3) { setFeedback('Agregá una nota de al menos 3 caracteres para registrar la decisión.'); return; }
    if (['resolve_won', 'resolve_lost', 'reject', 'cancel'].includes(event) && !window.confirm(`${eventLabels[event]} ${selected.id}?`)) return;
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/disputes/${selected.id}/events`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ event, note }) });
    const result = await response.json() as { requiresApproval?: boolean; approval?: { status: string }; error?: unknown };
    if (response.ok) {
      setFeedback(result.requiresApproval && result.approval?.status === 'pending'
        ? 'Solicitud creada: otro owner/admin con MFA debe aprobarla.' : 'Lifecycle actualizado y evento emitido.');
      setNote(''); await load();
    } else { setFeedback(apiError(result.error, 'No pudimos actualizar la disputa.')); setBusy(false); }
  }

  return <div className="module-view disputes-view">
    <div className="module-view-head"><div><p>DISPUTES &amp; CHARGEBACKS</p><h1>Disputas nativas</h1><span>Casos parciales, evidencia, doble control opt-in y créditos compensables sobre el ledger.</span></div><span className="module-health"><i /> Sandbox operativo</span></div>
    <div className="module-metrics"><article><strong>{metrics.open}</strong><span>disputas abiertas</span></article><article><strong>{metrics.provisional}</strong><span>créditos provisionales</span></article><article><strong>{metrics.won}</strong><span>resueltas a favor</span></article></div>
    <div className="network-boundary"><strong>Perímetro de red</strong><span>`network_ready` significa expediente preparado. Cimbra no lo presenta a una red de tarjetas sin sponsor, contrato y certificación directos.</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="disputes-layout">
      <section>
        {!readOnly && <article className="integration-card dispute-create"><div className="card-head"><div><h2>Abrir disputa</h2><p>Una por movimiento liquidado; hasta 90 días</p></div><b>{data.eligibleTransactions.length} ELEGIBLES</b></div>
          {data.eligibleTransactions.length === 0 ? <p className="role-boundary-copy">No hay débitos liquidados elegibles sin disputa.</p> : <form className="integration-form" onSubmit={create}>
            <label>Movimiento<select name="transactionId" required defaultValue=""><option value="" disabled>Seleccionar movimiento</option>{data.eligibleTransactions.map((item) => <option key={item.id} value={item.id}>{item.counterparty} · {money(item.disputableAmount, item.currency)}</option>)}</select></label>
            <label>Motivo<select name="reason" required defaultValue=""><option value="" disabled>Seleccionar motivo</option>{Object.entries(reasonLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Monto parcial<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Descripción<textarea name="description" minLength={3} maxLength={500} required placeholder="Contexto verificable del reclamo" /></label>
            <label className="inline-check"><input name="provisionalCredit" type="checkbox" /> Solicitar crédito provisional al iniciar la revisión</label>
            <button disabled={busy}>Abrir disputa</button>
          </form>}
        </article>}
        <article className="module-list dispute-list"><div className="card-head"><div><h2>Expedientes</h2><p>Lifecycle y monto disputado</p></div><b>{data.disputes.length}</b></div>
          {busy && data.disputes.length === 0 ? <p>Cargando…</p> : data.disputes.length === 0 ? <p>Sin disputas registradas.</p> : data.disputes.map((item) => <button className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.originalTransaction.counterparty}</strong><small>{reasonLabels[item.reason]} · {money(item.amount, item.currency)} · {item.creditStatus}</small></span><b className={`dispute-status ${item.status}`}>{statusLabels[item.status]}</b></button>)}
        </article>
      </section>
      <aside className="integration-card dispute-detail">{!selected ? <p>Seleccioná una disputa para ver su lifecycle.</p> : <>
        <div className="card-head"><div><small>{selected.id}</small><h2>{selected.originalTransaction.counterparty}</h2><p>{selected.description}</p></div><b className={`dispute-status ${selected.status}`}>{statusLabels[selected.status]}</b></div>
        <div className="case-facts"><span><small>Monto</small><strong>{money(selected.amount, selected.currency)}</strong></span><span><small>Crédito</small><strong>{selected.creditStatus}</strong></span><span><small>SLA</small><strong>{selected.dueAt ? new Date(selected.dueAt).toLocaleDateString('es-AR') : '—'}</strong></span></div>
        {!readOnly && selected.open && <div className="dispute-actions"><textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={500} placeholder="Nota obligatoria para la transición" />
          <div>{selected.possibleEvents.map((item) => <button className={['resolve_lost', 'reject', 'cancel'].includes(item) ? 'secondary' : ''} disabled={busy} key={item} onClick={() => void transition(item)}>{eventLabels[item]}</button>)}</div></div>}
        {readOnly && selected.open && <p className="role-boundary-copy">Tu rol puede auditar el expediente, pero no ejecutar transiciones.</p>}
        <section className="dispute-timeline"><h3>Timeline inmutable</h3>{timeline.map((item) => <article key={item.id}><i /><div><strong>{item.event}</strong><small>{item.fromStatus ? `${item.fromStatus} → ` : ''}{item.toStatus} · {item.actorName} · {new Date(item.createdAt).toLocaleString('es-AR')}</small><p>{item.note}</p></div></article>)}</section>
      </>}</aside>
    </div>
  </div>;
}
