'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Run = { id: string; name: string; source: string; currency: string; status: string; expected: number; actual: number; difference: number; matchedCount: number; exceptionCount: number; createdAt: string };
type Exception = { id: string; runId: string; kind: string; status: string; externalReference: string; transactionId: string | null; expected: number; actual: number; difference: number; currency: string; reason: string };

function money(value: number, currency: string) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value); }
function localDateInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

export default function ReconciliationPanel() {
  const [runs, setRuns] = useState<Run[]>([]); const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const openExceptions = useMemo(() => exceptions.filter((item) => item.status === 'open'), [exceptions]);
  const now = useMemo(() => new Date(), []); const start = useMemo(() => new Date(now.getTime() - 24 * 60 * 60 * 1000), [now]);

  async function load() {
    const response = await fetch('/api/v1/reconciliation', { cache: 'no-store' });
    const result = await response.json() as { data?: { runs: Run[]; exceptions: Exception[] }; error?: { message?: string } | string };
    if (!response.ok) return setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar conciliación.');
    setRuns(result.data?.runs ?? []); setExceptions(result.data?.exceptions ?? []);
  }
  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, []);

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setFeedback(''); const form = new FormData(formElement);
    const rows = String(form.get('entries') ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (rows[0]?.toLowerCase().includes('transactionid') && rows[0]?.toLowerCase().includes('direction')) rows.shift();
    const entries = rows.map((line) => {
      const [externalReference, transactionId, direction, amount] = line.split(',').map((part) => part.trim());
      return { externalReference, transactionId: transactionId || undefined, direction, amount };
    });
    const periodStart = new Date(String(form.get('periodStart'))); const periodEnd = new Date(String(form.get('periodEnd')));
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime())) {
      setFeedback('El período de conciliación es inválido.'); setBusy(false); return;
    }
    const response = await fetch('/api/v1/reconciliation/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: form.get('name'), source: form.get('source'), currency: form.get('currency'),
        periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), entries }) });
    const result = await response.json() as { error?: { message?: string } | string; run?: Run };
    setFeedback(response.ok ? `Conciliación creada: ${result.run?.matchedCount ?? 0} matches y ${result.run?.exceptionCount ?? 0} excepciones.`
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear la conciliación.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function resolveException(id: string, resolution: 'corrected' | 'accepted') {
    setBusy(true); const response = await fetch(`/api/v1/reconciliation/exceptions/${id}/resolve`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ resolution, note: `Excepción ${resolution} desde consola sandbox.` }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Excepción resuelta y corrida recalculada.' : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos resolver la excepción.');
    if (response.ok) await load(); setBusy(false);
  }

  return <div className="module-view reconciliation-console">
    <div className="module-view-head"><div><p>RECONCILIATION & SETTLEMENT</p><h1>Conciliación operativa</h1><span>Comparación exacta entre ledger Cimbra y lotes de bancos, cámaras o redes.</span></div><span className="module-health"><i /> {openExceptions.length} excepciones abiertas</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics"><article><strong>{runs.length}</strong><span>corridas registradas</span></article><article><strong>{runs.reduce((sum, run) => sum + run.matchedCount, 0)}</strong><span>partidas conciliadas</span></article><article><strong>{openExceptions.length}</strong><span>diferencias pendientes</span></article></div>
    <div className="integration-grid reconciliation-grid"><article className="integration-card"><div className="card-head"><div><h2>Nueva corrida</h2><p>Hasta 500 partidas por lote sandbox</p></div><b>3-WAY</b></div>
      <form className="integration-form" onSubmit={createRun}><div className="integration-fields"><label>Nombre<input name="name" placeholder="Cierre banco 28/08" minLength={2} required /></label><label>Origen<select name="source"><option value="bank">Banco</option><option value="clearing">Cámara</option><option value="card_network">Red de tarjetas</option><option value="cash_network">Red de efectivo</option><option value="internal">Control interno</option></select></label></div><div className="integration-fields"><label>Desde<input name="periodStart" type="datetime-local" defaultValue={localDateInput(start)} required /></label><label>Hasta<input name="periodEnd" type="datetime-local" defaultValue={localDateInput(now)} required /></label></div><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label><label>Partidas CSV<textarea name="entries" rows={7} placeholder={'referencia,transactionId,direction,amount\nBANCO-001,uuid,credit,1250.00\nBANCO-002,,debit,500.00'} /></label><small>Formato: referencia, transactionId opcional, credit/debit, importe positivo. Un lote vacío identifica todos los movimientos Cimbra faltantes en el origen.</small><button disabled={busy}>Ejecutar conciliación</button></form>
    </article><article className="integration-card"><div className="card-head"><div><h2>Corridas</h2><p>Totales y diferencias reproducibles</p></div><b>{runs.length}</b></div><div className="integration-list compact-list">{runs.length === 0 ? <p>Sin conciliaciones ejecutadas.</p> : runs.map((run) => <div key={run.id}><span><strong>{run.name}</strong><small>{run.source} · {run.currency} · esperado {money(run.expected, run.currency)} · externo {money(run.actual, run.currency)} · diferencia {money(run.difference, run.currency)}</small></span><b className={run.status}>{run.status}</b></div>)}</div></article></div>
    <article className="module-list"><div className="card-head"><div><h2>Cola de excepciones</h2><p>Faltantes y diferencias con resolución auditable</p></div><b>{openExceptions.length} abiertas</b></div>{openExceptions.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin diferencias pendientes<small>Todos los lotes están conciliados o resueltos</small></b></span><strong>Al día</strong></div> : openExceptions.map((item) => <div key={item.id}><span className="movement"><i>!</i><b>{item.externalReference}<small>{item.kind} · esperado {money(item.expected, item.currency)} · externo {money(item.actual, item.currency)} · diferencia {money(item.difference, item.currency)}</small></b></span><span className="hold-actions"><button disabled={busy} onClick={() => void resolveException(item.id, 'accepted')}>Aceptar diferencia</button><button disabled={busy} onClick={() => void resolveException(item.id, 'corrected')}>Marcar corregida</button></span></div>)}</article>
  </div>;
}
