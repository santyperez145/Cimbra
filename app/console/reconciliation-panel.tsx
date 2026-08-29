'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Run = { id: string; name: string; source: string; currency: string; status: string; ingestionMode: 'api' | 'csv'; fileName: string | null; expected: number; actual: number; difference: number; matchedCount: number; exceptionCount: number; createdAt: string };
type Exception = { id: string; runId: string; kind: string; status: string; externalReference: string; transactionId: string | null; expected: number; actual: number; difference: number; currency: string; reason: string };
type Settlement = { id: string; reconciliationRunId: string; name: string; rail: string; currency: string; status: 'ready' | 'scheduled' | 'settled'; net: number; difference: number; scheduledFor: string | null; settledAt: string | null };

function money(value: number, currency: string) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value); }
function localDateInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export default function ReconciliationPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [runs, setRuns] = useState<Run[]>([]); const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]); const [ingestionMode, setIngestionMode] = useState<'api' | 'csv'>('csv');
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const openExceptions = useMemo(() => exceptions.filter((item) => item.status === 'open'), [exceptions]);
  const now = useMemo(() => new Date(), []); const start = useMemo(() => new Date(now.getTime() - 24 * 60 * 60 * 1000), [now]);

  async function load() {
    const [response, settlementResponse] = await Promise.all([
      authenticatedFetch('/api/v1/reconciliation', { cache: 'no-store' }), authenticatedFetch('/api/v1/settlements', { cache: 'no-store' }),
    ]);
    const result = await response.json() as { data?: { runs: Run[]; exceptions: Exception[] }; error?: { message?: string } | string };
    const settlementResult = await settlementResponse.json() as { data?: Settlement[]; error?: { message?: string } | string };
    if (!response.ok) return setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar conciliación.');
    if (!settlementResponse.ok) return setFeedback(typeof settlementResult.error === 'string' ? settlementResult.error : settlementResult.error?.message ?? 'No pudimos cargar settlement.');
    setRuns(result.data?.runs ?? []); setExceptions(result.data?.exceptions ?? []); setSettlements(settlementResult.data ?? []);
  }
  useEffect(() => {
    const task = window.setTimeout(() => { setCurrentTime(Date.now()); void load(); }, 0);
    const clock = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => { window.clearTimeout(task); window.clearInterval(clock); };
  }, []);

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setFeedback(''); const form = new FormData(formElement);
    const periodStart = new Date(String(form.get('periodStart'))); const periodEnd = new Date(String(form.get('periodEnd')));
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime())) {
      setFeedback('El período de conciliación es inválido.'); setBusy(false); return;
    }
    let response: Response;
    if (ingestionMode === 'csv') {
      form.set('periodStart', periodStart.toISOString()); form.set('periodEnd', periodEnd.toISOString());
      response = await authenticatedFetch('/api/v1/reconciliation/imports', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: form });
    } else {
      const rows = String(form.get('entries') ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (rows[0]?.toLowerCase().includes('transactionid') && rows[0]?.toLowerCase().includes('direction')) rows.shift();
      const entries = rows.map((line) => {
        const [externalReference, transactionId, direction, amount] = line.split(',').map((part) => part.trim());
        return { externalReference, transactionId: transactionId || undefined, direction, amount };
      });
      response = await authenticatedFetch('/api/v1/reconciliation/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ name: form.get('name'), source: form.get('source'), currency: form.get('currency'),
          periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), entries }) });
    }
    const result = await response.json() as { error?: { message?: string } | string; run?: Run };
    setFeedback(response.ok ? `Conciliación creada: ${result.run?.matchedCount ?? 0} matches y ${result.run?.exceptionCount ?? 0} excepciones.`
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear la conciliación.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function createSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback('');
    const rawSchedule = String(form.get('scheduledFor') ?? '');
    const scheduledFor = rawSchedule ? new Date(rawSchedule) : null;
    if (scheduledFor && !Number.isFinite(scheduledFor.getTime())) { setFeedback('La fecha programada es inválida.'); setBusy(false); return; }
    const response = await authenticatedFetch('/api/v1/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ reconciliationRunId: form.get('reconciliationRunId'), name: form.get('name'), scheduledFor: scheduledFor?.toISOString() }) });
    const result = await response.json() as { error?: { message?: string } | string; cycle?: Settlement };
    setFeedback(response.ok ? `Ciclo ${result.cycle?.status === 'scheduled' ? 'programado' : 'listo'}; no mueve fondos reales.`
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear el settlement.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function executeSettlement(id: string) {
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/settlements/${id}/execute`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    const result = await response.json() as { error?: { message?: string } | string; requiresApproval?: boolean; approval?: { status?: string } };
    setFeedback(response.ok ? result.requiresApproval && result.approval?.status === 'pending'
      ? 'Solicitud enviada a doble aprobación. Otro owner/admin con MFA debe decidirla.'
      : 'Settlement sandbox ejecutado y evento emitido.' : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos ejecutar el settlement.');
    if (response.ok) await load(); setBusy(false);
  }

  async function resolveException(id: string, resolution: 'corrected' | 'accepted') {
    setBusy(true); const response = await authenticatedFetch(`/api/v1/reconciliation/exceptions/${id}/resolve`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ resolution, note: `Excepción ${resolution} desde consola sandbox.` }) });
    const result = await response.json() as { error?: { message?: string } | string; requiresApproval?: boolean; approval?: { status?: string } };
    setFeedback(response.ok ? result.requiresApproval && result.approval?.status === 'pending'
      ? 'Solicitud enviada a doble aprobación. La diferencia sigue abierta hasta la decisión independiente.'
      : 'Excepción resuelta y corrida recalculada.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos resolver la excepción.');
    if (response.ok) await load(); setBusy(false);
  }

  return <div className="module-view reconciliation-console">
    <div className="module-view-head"><div><p>RECONCILIATION & SETTLEMENT</p><h1>Conciliación operativa</h1><span>Comparación exacta entre ledger Cimbra y lotes de bancos, cámaras o redes.</span></div><span className="module-health"><i /> {openExceptions.length} excepciones abiertas</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics"><article><strong>{runs.length}</strong><span>corridas registradas</span></article><article><strong>{runs.reduce((sum, run) => sum + run.matchedCount, 0)}</strong><span>partidas conciliadas</span></article><article><strong>{settlements.filter((item) => item.status === 'settled').length}</strong><span>settlements cerrados</span></article></div>
    <div className="integration-grid reconciliation-grid"><article className="integration-card"><div className="card-head"><div><h2>{readOnly ? 'Acceso de auditoría' : 'Nueva corrida'}</h2><p>{readOnly ? 'Tu rol consulta resultados sin modificar la operación' : 'Hasta 500 partidas por lote sandbox'}</p></div><b>{readOnly ? 'READ ONLY' : '3-WAY'}</b></div>
      {readOnly ? <p className="role-boundary-copy">Las corridas, excepciones y ciclos permanecen visibles. Crear, resolver o ejecutar requiere un rol operativo.</p> : <form className="integration-form" onSubmit={createRun}><div className="integration-fields"><label>Nombre<input name="name" placeholder="Cierre banco 28/08" minLength={2} required /></label><label>Origen<select name="source"><option value="bank">Banco</option><option value="clearing">Cámara</option><option value="card_network">Red de tarjetas</option><option value="cash_network">Red de efectivo</option><option value="internal">Control interno</option></select></label></div><div className="integration-fields"><label>Desde<input name="periodStart" type="datetime-local" defaultValue={localDateInput(start)} required /></label><label>Hasta<input name="periodEnd" type="datetime-local" defaultValue={localDateInput(now)} required /></label></div><div className="integration-fields"><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label><label>Ingestión<select value={ingestionMode} onChange={(event) => setIngestionMode(event.target.value as 'api' | 'csv')}><option value="csv">Archivo CSV</option><option value="api">Partidas manuales</option></select></label></div>{ingestionMode === 'csv' ? <label>Archivo canónico<input name="file" type="file" accept=".csv,text/csv" required /></label> : <label>Partidas CSV<textarea name="entries" rows={7} placeholder={'externalReference,transactionId,direction,amount\nBANCO-001,uuid,credit,1250.00\nBANCO-002,,debit,500.00'} /></label>}<small>Archivo: external_reference, transaction_id opcional, direction y amount. Máximo 500 partidas/2 MB; se registra checksum, no el archivo crudo.</small><button disabled={busy}>Ejecutar conciliación</button></form>}
    </article><article className="integration-card"><div className="card-head"><div><h2>Corridas</h2><p>Totales y diferencias reproducibles</p></div><b>{runs.length}</b></div><div className="integration-list compact-list">{runs.length === 0 ? <p>Sin conciliaciones ejecutadas.</p> : runs.map((run) => <div key={run.id}><span><strong>{run.name}</strong><small>{run.source} · {run.ingestionMode}{run.fileName ? ` · ${run.fileName}` : ''} · {run.currency} · esperado {money(run.expected, run.currency)} · externo {money(run.actual, run.currency)} · diferencia {money(run.difference, run.currency)}</small></span><b className={run.status}>{run.status}</b></div>)}</div></article></div>
    <div className="integration-grid reconciliation-grid"><article className="integration-card"><div className="card-head"><div><h2>Nuevo settlement</h2><p>Requiere conciliación cerrada y es sandbox</p></div><b>SCHEDULED</b></div>{readOnly ? <p className="role-boundary-copy">La creación y programación está reservada a roles operativos.</p> : <form className="integration-form" onSubmit={createSettlement}><label>Conciliación<select name="reconciliationRunId" required defaultValue=""><option value="" disabled>Seleccionar corrida</option>{runs.filter((run) => run.status === 'completed' && !settlements.some((cycle) => cycle.reconciliationRunId === run.id)).map((run) => <option key={run.id} value={run.id}>{run.name} · {run.currency}</option>)}</select></label><label>Nombre<input name="name" placeholder="Liquidación banco diaria" minLength={2} required /></label><label>Programar (opcional)<input name="scheduledFor" type="datetime-local" /></label><button disabled={busy}>Crear ciclo</button></form>}</article><article className="integration-card"><div className="card-head"><div><h2>Ciclos de settlement</h2><p>Confirmación operativa, sin fondos reales</p></div><b>{settlements.length}</b></div><div className="integration-list compact-list">{settlements.length === 0 ? <p>Sin ciclos creados.</p> : settlements.map((cycle) => <div key={cycle.id}><span><strong>{cycle.name}</strong><small>{cycle.rail} · {money(cycle.net, cycle.currency)} · diferencia {money(cycle.difference, cycle.currency)}{cycle.scheduledFor ? ` · ${new Date(cycle.scheduledFor).toLocaleString('es-AR')}` : ''}</small></span><b className={cycle.status}>{cycle.status}</b>{!readOnly && (cycle.status === 'ready' || cycle.status === 'scheduled' && Boolean(cycle.scheduledFor) && Date.parse(cycle.scheduledFor!) <= currentTime) && <button disabled={busy} onClick={() => void executeSettlement(cycle.id)}>Ejecutar</button>}</div>)}</div></article></div>
    <article className="module-list"><div className="card-head"><div><h2>Cola de excepciones</h2><p>Faltantes y diferencias con resolución auditable</p></div><b>{openExceptions.length} abiertas</b></div>{openExceptions.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin diferencias pendientes<small>Todos los lotes están conciliados o resueltos</small></b></span><strong>Al día</strong></div> : openExceptions.map((item) => <div key={item.id}><span className="movement"><i>!</i><b>{item.externalReference}<small>{item.kind} · esperado {money(item.expected, item.currency)} · externo {money(item.actual, item.currency)} · diferencia {money(item.difference, item.currency)}</small></b></span>{readOnly ? <strong>Pendiente</strong> : <span className="hold-actions"><button disabled={busy} onClick={() => void resolveException(item.id, 'accepted')}>Aceptar diferencia</button><button disabled={busy} onClick={() => void resolveException(item.id, 'corrected')}>Marcar corregida</button></span>}</div>)}</article>
  </div>;
}
