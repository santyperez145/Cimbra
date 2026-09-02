'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type AuditEvent = {
  id: string; action: string; resourceType: string; resourceId: string; payload: unknown; createdAt: string;
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function payloadText(payload: unknown) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  const loadMore = useCallback(async (cursor: string) => {
    const response = await authenticatedFetch(`/api/v1/events?limit=50&cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' });
    const result = await response.json() as { data?: AuditEvent[]; nextCursor?: string | null; error?: unknown };
    if (!response.ok || !result.data) throw new Error(apiError(result, 'No pudimos paginar la auditoría.'));
    setEvents((current) => [...current, ...result.data!]);
    setNextCursor(result.nextCursor ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/v1/events?limit=50', { cache: 'no-store' }).then(async (response) => {
      const result = await response.json() as { data?: AuditEvent[]; nextCursor?: string | null; error?: unknown };
      if (!active) return;
      if (!response.ok || !result.data) setFeedback(apiError(result, 'No pudimos cargar la auditoría.'));
      else {
        setEvents(result.data);
        setNextCursor(result.nextCursor ?? null);
        setSelectedId((current) => current && result.data!.some((item) => item.id === current) ? current : result.data![0]?.id ?? '');
      }
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con el registro de auditoría.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  const resourceTypes = useMemo(() => [...new Set(events.map((item) => item.resourceType))].sort(), [events]);
  const visible = events.filter((item) => {
    if (resourceFilter !== 'all' && item.resourceType !== resourceFilter) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${item.action} ${item.resourceType} ${item.resourceId} ${item.id} ${payloadText(item.payload)}`.toLowerCase().includes(needle);
  });
  const selected = events.find((item) => item.id === selectedId) ?? null;
  const selectedPayload = selected ? payloadText(selected.payload) : '';

  function exportLoaded() {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['id', 'action', 'resource_type', 'resource_id', 'created_at', 'payload'],
      ...visible.map((item) => [item.id, item.action, item.resourceType, item.resourceId, item.createdAt, payloadText(item.payload)])];
    const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cimbra-auditoria.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="module-view operations-view">
    <div className="module-view-head">
      <div>
        <p>AUDITORÍA</p>
        <h1>Registro inmutable del tenant</h1>
        <span>GET /api/v1/events. Append-only, aislado por organización. No es un SIEM ni una presentación regulatoria.</span>
      </div>
      <button className="app-primary" disabled={visible.length === 0} onClick={exportLoaded}>Exportar CSV ↓</button>
    </div>
    <div className="module-metrics">
      <article><strong>{events.length}</strong><span>eventos cargados</span></article>
      <article><strong>{resourceTypes.length}</strong><span>tipos de recurso</span></article>
      <article><strong>{nextCursor ? 'Sí' : 'No'}</strong><span>hay más páginas</span></article>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar">
          <input aria-label="Buscar evento" placeholder="⌕ Acción, recurso o id" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div>
            <button className={resourceFilter === 'all' ? 'active' : ''} onClick={() => setResourceFilter('all')}>Todos</button>
            {resourceTypes.map((type) => <button key={type} className={resourceFilter === type ? 'active' : ''} onClick={() => setResourceFilter(type)}>{type}</button>)}
          </div>
        </div>
        {busy && events.length === 0 ? <p className="operations-empty">Cargando auditoría…</p> : visible.length === 0
          ? <p className="operations-empty">{events.length === 0 ? 'Todavía no hay eventos de auditoría en este tenant.' : 'Ningún evento coincide con el filtro.'}</p>
          : visible.map((item) => <button key={item.id} className={`work-item-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            <span className="work-priority low" />
            <span><strong>{item.action}</strong><small>{item.resourceType} · {item.resourceId}</small></span>
            <span><b>{new Date(item.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</b><small>{new Date(item.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</small></span>
            <em className="sla-on_track">append-only</em>
          </button>)}
        {nextCursor && <div className="case-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void loadMore(nextCursor).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'No pudimos paginar.')).finally(() => setBusy(false)); }}>Cargar más</button></div>}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná un evento para ver el payload persistido.</p> : <>
          <div className="operations-detail-head">
            <div><small>{selected.resourceType.toUpperCase()}</small><h2>{selected.action}</h2><p>{selected.id}</p></div>
            <span className="priority-badge low">Inmutable</span>
          </div>
          <div className="case-facts">
            <span><small>Recurso</small><strong>{selected.resourceId}</strong></span>
            <span><small>Registrado</small><strong>{new Date(selected.createdAt).toLocaleString('es-AR')}</strong></span>
            <span><small>Tipo</small><strong>{selected.resourceType}</strong></span>
          </div>
          <section className="case-thread">
            <h3>Payload</h3>
            {selectedPayload && selectedPayload !== '{}' ? <pre>{selectedPayload}</pre> : <p>Este evento no guarda un payload adicional.</p>}
            <p>El asiento no se edita ni se borra. Un webhook de integración es un destino distinto: se opera en Developers.</p>
          </section>
        </>}
      </aside>
    </div>
  </div>;
}
