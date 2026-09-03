'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CURRENCIES } from '@/app/lib/ledger/money';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Transfer = {
  id: string; counterparty: string; description: string; amount: number; amountMinor: string;
  currency: string; status: string; riskScore: number; reversalOf: string | null; createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  settled: 'Liquidado', authorized: 'Autorizado', review: 'En revisión', pending: 'Pendiente',
  reversed: 'Revertido', cancelled: 'Cancelado',
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

export default function TransfersPanel({ role, refreshKey = 0 }: { role: OrganizationRole; refreshKey?: number }) {
  const router = useRouter();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [currency, setCurrency] = useState('ARS');
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');
  const canWrite = roleCan(role, 'finance.write');

  const loadFirst = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/transfers?limit=50', { cache: 'no-store' });
    const result = await response.json() as { data?: Transfer[]; nextCursor?: string | null; error?: unknown };
    if (!response.ok || !result.data) throw new Error(apiError(result, 'No pudimos cargar los movimientos.'));
    setTransfers(result.data);
    setNextCursor(result.nextCursor ?? null);
    setSelectedId((current) => current && result.data!.some((item) => item.id === current) ? current : result.data![0]?.id ?? '');
  }, []);

  const loadMore = useCallback(async (cursor: string) => {
    const response = await authenticatedFetch(`/api/v1/transfers?limit=50&cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' });
    const result = await response.json() as { data?: Transfer[]; nextCursor?: string | null; error?: unknown };
    if (!response.ok || !result.data) throw new Error(apiError(result, 'No pudimos paginar los movimientos.'));
    setTransfers((current) => [...current, ...result.data!]);
    setNextCursor(result.nextCursor ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    const task = window.setTimeout(() => {
      void loadFirst().then(() => { if (active) setBusy(false); })
        .catch((error: unknown) => { if (active) { setFeedback(error instanceof Error ? error.message : 'No pudimos conectar con transferencias.'); setBusy(false); } });
    }, 0);
    return () => { active = false; window.clearTimeout(task); };
  }, [loadFirst, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void authenticatedFetch(`/api/v1/transfers/${selectedId}`, { cache: 'no-store' }).then(async (response) => {
      const result = await response.json() as Transfer & { error?: unknown };
      if (!active) return;
      if (response.ok && result.id) setDetail(result);
      else setFeedback(apiError(result, 'No pudimos abrir el movimiento.'));
    }).catch(() => { if (active) setFeedback('No pudimos conectar con transferencias.'); });
    return () => { active = false; };
  }, [selectedId]);

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        counterparty: values.get('counterparty'), description: values.get('description'),
        amount: values.get('amount'), currency: values.get('currency'),
      }),
    });
    const result = await response.json() as { transaction?: Transfer; requiresApproval?: boolean; error?: unknown };
    if (!response.ok) setFeedback(apiError(result, 'No pudimos crear la transferencia.'));
    else {
      form.reset();
      setCurrency('ARS');
      setComposing(false);
      if (result.requiresApproval) setFeedback('Solicitud creada. Otro owner/admin con MFA debe aprobarla desde Aprobaciones.');
      else setFeedback(result.transaction?.status === 'review' ? 'Transferencia creada y enviada a revisión.' : 'Transferencia liquidada en sandbox. No mueve fondos reales.');
      if (result.transaction) {
        setTransfers((current) => [result.transaction!, ...current.filter((item) => item.id !== result.transaction!.id)]);
        setSelectedId(result.transaction.id);
      } else await loadFirst();
      router.refresh();
    }
    setBusy(false);
  }

  async function reverseTransfer(id: string) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/transfers/${id}/reverse`, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as { transaction?: Transfer; requiresApproval?: boolean; error?: unknown };
    if (response.ok) {
      setFeedback(result.requiresApproval
        ? 'Reversa enviada a Aprobaciones (maker/checker).'
        : 'Reversa compensatoria posteada. El asiento original no se mutó.');
      await loadFirst();
      router.refresh();
    } else setFeedback(apiError(result, 'No pudimos revertir la transferencia.'));
    setBusy(false);
  }

  const visible = transfers.filter((item) => {
    if (direction === 'in' && item.amount <= 0) return false;
    if (direction === 'out' && item.amount >= 0) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${item.counterparty} ${item.description} ${item.id} ${item.status}`.toLowerCase().includes(needle);
  });
  const selected = detail && detail.id === selectedId ? detail : transfers.find((item) => item.id === selectedId) ?? null;
  const canReverse = Boolean(selected && canWrite && selected.amount < 0 && selected.status === 'settled' && !selected.reversalOf);

  function exportLoaded() {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['id', 'counterparty', 'description', 'amount_minor', 'currency', 'status', 'created_at'],
      ...visible.map((item) => [item.id, item.counterparty, item.description, item.amountMinor, item.currency, item.status, item.createdAt])];
    const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cimbra-movimientos.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="module-view operations-view">
    <div className="module-view-head">
      <div>
        <p>OPERACIONES</p>
        <h1>Movimientos</h1>
        <span>GET/POST /api/v1/transfers. Cada fila es un asiento persistido. La reversa crea un posting compensatorio.</span>
      </div>
      {canWrite && <button className="app-primary" onClick={() => setComposing((value) => !value)}>{composing ? 'Cancelar' : '+ Nueva transferencia'}</button>}
    </div>
    <div className="module-metrics">
      <article><strong>{transfers.length}</strong><span>movimientos cargados</span></article>
      <article><strong>{transfers.filter((item) => item.amount > 0).length}</strong><span>ingresos</span></article>
      <article><strong>{transfers.filter((item) => item.amount < 0).length}</strong><span>egresos</span></article>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {composing && canWrite && <form className="case-form support-compose" onSubmit={createTransfer}>
      <div>
        <label>Destinatario<input name="counterparty" minLength={2} maxLength={120} placeholder="Ej. Proveedor Andino" required /></label>
        <label>Concepto<input name="description" minLength={2} maxLength={180} placeholder="Ej. Pago de servicios" required /></label>
      </div>
      <div>
        <label>Monto<input name="amount" type="number" min={currency === 'CLP' ? '1' : '0.01'} max="10000000" step={currency === 'CLP' ? '1' : '0.01'} required /></label>
        <label>Moneda<select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="case-actions"><button disabled={busy}>Crear transferencia</button></div>
    </form>}
    {!canWrite && <p className="operations-empty">Tu rol puede consultar movimientos y exportarlos, pero no crear ni revertir.</p>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar">
          <input aria-label="Buscar movimiento" placeholder="⌕ Contraparte, concepto o id" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div>
            <button className={direction === 'all' ? 'active' : ''} onClick={() => setDirection('all')}>Todos</button>
            <button className={direction === 'in' ? 'active' : ''} onClick={() => setDirection('in')}>Ingresos</button>
            <button className={direction === 'out' ? 'active' : ''} onClick={() => setDirection('out')}>Egresos</button>
            <button disabled={visible.length === 0} onClick={exportLoaded}>Exportar CSV ↓</button>
          </div>
        </div>
        {busy && transfers.length === 0 ? <p className="operations-empty">Cargando movimientos…</p> : visible.length === 0
          ? <p className="operations-empty">{transfers.length === 0 ? 'Todavía no hay transferencias en este tenant.' : 'Ningún movimiento coincide con el filtro.'}</p>
          : visible.map((item) => <button key={item.id} className={`work-item-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            <span className={`work-priority ${item.amount < 0 ? 'medium' : 'low'}`} />
            <span><strong>{item.counterparty}</strong><small>{item.description}</small></span>
            <span><b className={item.amount < 0 ? '' : 'positive'}>{item.amount > 0 ? '+' : ''}{money(item.amount, item.currency)}</b><small>{item.currency}</small></span>
            <em className={item.status === 'settled' ? 'sla-on_track' : 'sla-none'}>{STATUS_LABELS[item.status] ?? item.status}</em>
          </button>)}
        {nextCursor && <div className="case-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void loadMore(nextCursor).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'No pudimos paginar.')).finally(() => setBusy(false)); }}>Cargar más</button></div>}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná un movimiento para ver el asiento.</p> : <>
          <div className="operations-detail-head">
            <div><small>{selected.currency}</small><h2>{selected.counterparty}</h2><p>{selected.id}</p></div>
            <span className={`priority-badge ${selected.status === 'settled' ? 'low' : 'high'}`}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
          </div>
          <div className="case-facts">
            <span><small>Monto</small><strong>{selected.amount > 0 ? '+' : ''}{money(selected.amount, selected.currency)}</strong></span>
            <span><small>Riesgo</small><strong>{selected.riskScore}</strong></span>
            <span><small>Registrado</small><strong>{new Date(selected.createdAt).toLocaleString('es-AR')}</strong></span>
          </div>
          <section className="case-thread">
            <h3>Asiento</h3>
            <p>{selected.description}</p>
            {selected.reversalOf ? <p>Esta fila es la reversa de {selected.reversalOf}.</p> : null}
            {canReverse && <div className="case-actions"><button type="button" disabled={busy} onClick={() => void reverseTransfer(selected.id)}>Revertir con compensación</button></div>}
            <p>Sandbox: no mueve fondos reales. Un monto alto puede exigir maker/checker en Aprobaciones.</p>
          </section>
        </>}
      </aside>
    </div>
  </div>;
}
