'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type WorkItemType = 'risk_case' | 'reconciliation_exception';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type WorkItem = {
  id: string; type: WorkItemType; status: string; priority: Priority;
  assignee: { userId: string; displayName: string; email: string } | null; dueAt: string | null; escalatedAt: string | null;
  slaStatus: 'none' | 'overdue' | 'due_soon' | 'on_track'; reference: string; summary: string;
  amount: number; currency: string; noteCount: number; evidenceCount: number; createdAt: string; updatedAt: string;
};
type Member = { userId: string; displayName: string; email: string; role: string };
type Document = { id: string; fileName: string; contentType: string; status: string; createdAt: string };
type Note = { id: string; subjectType: WorkItemType; subjectId: string; body: string; authorName: string; createdAt: string };
type Evidence = { id: string; subjectType: WorkItemType; subjectId: string; documentId: string; fileName: string; linkedByName: string; createdAt: string };
type OperationalState = { workItems: WorkItem[]; members: Member[]; documents: Document[]; notes: Note[]; evidence: Evidence[] };

const emptyState: OperationalState = { workItems: [], members: [], documents: [], notes: [], evidence: [] };

function routeType(type: WorkItemType) {
  return type === 'risk_case' ? 'risk-case' : 'reconciliation-exception';
}

function dueInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

export default function OperationsPanel({ readOnly }: { readOnly: boolean }) {
  const [data, setData] = useState<OperationalState>(emptyState);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [type, setType] = useState<'all' | WorkItemType>('all');
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/v1/operations/work-items');
      const result = await response.json() as { data?: OperationalState; error?: string };
      if (response.ok && result.data) {
        setData(result.data);
        setSelectedId((current) => current && result.data!.workItems.some((item) => item.id === current)
          ? current : result.data!.workItems.find((item) => item.status === 'open')?.id ?? result.data!.workItems[0]?.id ?? '');
      } else setFeedback(result.error ?? 'No pudimos cargar la cola operativa.');
    } catch { setFeedback('No pudimos conectar con la cola operativa.'); }
    setBusy(false);
  }, []);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/v1/operations/work-items').then(async (response) => {
      const result = await response.json() as { data?: OperationalState; error?: string };
      if (!active) return;
      if (response.ok && result.data) {
        setData(result.data);
        setSelectedId(result.data.workItems.find((item) => item.status === 'open')?.id ?? result.data.workItems[0]?.id ?? '');
      } else setFeedback(result.error ?? 'No pudimos cargar la cola operativa.');
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con la cola operativa.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => data.workItems.filter((item) =>
    (status === 'all' || item.status === 'open') && (type === 'all' || item.type === type)), [data.workItems, status, type]);
  const selected = data.workItems.find((item) => item.id === selectedId) ?? null;
  const notes = selected ? data.notes.filter((note) => note.subjectId === selected.id && note.subjectType === selected.type) : [];
  const evidence = selected ? data.evidence.filter((link) => link.subjectId === selected.id && link.subjectType === selected.type) : [];

  async function updateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setFeedback(''); const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch(`/api/v1/operations/work-items/${routeType(selected.type)}/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ assignedToUserId: form.get('assignee') || null, priority: form.get('priority'),
        dueAt: form.get('dueAt') ? new Date(String(form.get('dueAt'))).toISOString() : null }),
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Caso actualizado con auditoría e idempotencia.' : result.error ?? 'No pudimos actualizar el caso.');
    if (response.ok) await load(); else setBusy(false);
  }

  async function toggleEscalation() {
    if (!selected) return; setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/operations/work-items/${routeType(selected.type)}/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ escalated: !selected.escalatedAt }),
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? (selected.escalatedAt ? 'Escalamiento retirado.' : 'Caso escalado.') : result.error ?? 'No pudimos cambiar el escalamiento.');
    if (response.ok) await load(); else setBusy(false);
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = event.currentTarget; const body = new FormData(form).get('body');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/operations/work-items/${routeType(selected.type)}/${selected.id}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ body }),
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Comentario agregado al expediente.' : result.error ?? 'No pudimos agregar el comentario.');
    if (response.ok) { form.reset(); await load(); } else setBusy(false);
  }

  async function linkEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = event.currentTarget; const documentId = new FormData(form).get('documentId');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/operations/work-items/${routeType(selected.type)}/${selected.id}/evidence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ documentId }),
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Evidencia vinculada al expediente.' : result.error ?? 'No pudimos vincular la evidencia.');
    if (response.ok) { form.reset(); await load(); } else setBusy(false);
  }

  const open = data.workItems.filter((item) => item.status === 'open').length;
  const overdue = data.workItems.filter((item) => item.slaStatus === 'overdue').length;
  const unassigned = data.workItems.filter((item) => item.status === 'open' && !item.assignee).length;

  return <div className="module-view operations-view">
    <div className="module-view-head"><div><p>OPERATIONS CONTROL</p><h1>Cola operativa</h1><span>Casos de riesgo y conciliación con ownership, SLA y expediente verificable.</span></div><span className="module-health"><i /> {open} abiertos</span></div>
    <div className="module-metrics"><article><strong>{open}</strong><span>casos abiertos</span></article><article><strong>{overdue}</strong><span>SLA vencidos</span></article><article><strong>{unassigned}</strong><span>sin responsable</span></article></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar"><div><button className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>Abiertos</button><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>Todos</button></div><select aria-label="Filtrar dominio" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">Todos los dominios</option><option value="risk_case">Riesgo</option><option value="reconciliation_exception">Conciliación</option></select></div>
        {busy && data.workItems.length === 0 ? <p className="operations-empty">Cargando expedientes…</p> : filtered.length === 0 ? <p className="operations-empty">No hay casos para este filtro.</p> : filtered.map((item) =>
          <button key={`${item.type}-${item.id}`} className={`work-item-row ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            <span className={`work-priority ${item.priority}`} />
            <span><strong>{item.reference}</strong><small>{item.type === 'risk_case' ? 'Riesgo' : 'Conciliación'} · {item.summary}</small></span>
            <span><b>{money(item.amount, item.currency)}</b><small>{item.assignee?.displayName ?? 'Sin responsable'}</small></span>
            <em className={`sla-${item.slaStatus}`}>{item.slaStatus === 'overdue' ? 'SLA vencido' : item.slaStatus === 'due_soon' ? 'Vence pronto' : item.status === 'open' ? 'En curso' : 'Cerrado'}</em>
          </button>)}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná un caso para abrir el expediente.</p> : <>
          <div className="operations-detail-head"><div><small>{selected.type === 'risk_case' ? 'CASO DE RIESGO' : 'EXCEPCIÓN DE CONCILIACIÓN'}</small><h2>{selected.reference}</h2><p>{selected.id}</p></div><span className={`priority-badge ${selected.priority}`}>{selected.priority}</span></div>
          <div className="case-facts"><span><small>Estado</small><strong>{selected.status}</strong></span><span><small>SLA</small><strong>{selected.dueAt ? new Date(selected.dueAt).toLocaleString('es-AR') : 'Sin fecha'}</strong></span><span><small>Expediente</small><strong>{selected.noteCount} notas · {selected.evidenceCount} evidencias</strong></span></div>
          {!readOnly && selected.status === 'open' && <form className="case-form" onSubmit={updateItem}><div><label>Responsable<select name="assignee" defaultValue={selected.assignee?.userId ?? ''} key={`assignee-${selected.id}-${selected.updatedAt}`}><option value="">Sin asignar</option>{data.members.filter((member) => member.role !== 'viewer').map((member) => <option key={member.userId} value={member.userId}>{member.displayName} · {member.role}</option>)}</select></label><label>Prioridad<select name="priority" defaultValue={selected.priority} key={`priority-${selected.id}-${selected.updatedAt}`}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label></div><label>Vencimiento SLA<input name="dueAt" type="datetime-local" defaultValue={dueInput(selected.dueAt)} key={`due-${selected.id}-${selected.updatedAt}`} /></label><div className="case-actions"><button disabled={busy}>Guardar cambios</button><button type="button" className="secondary" disabled={busy} onClick={toggleEscalation}>{selected.escalatedAt ? 'Quitar escalamiento' : 'Escalar caso'}</button></div></form>}
          <section className="case-thread"><h3>Comentarios</h3>{notes.length === 0 ? <p>Sin comentarios todavía.</p> : notes.map((note) => <article key={note.id}><strong>{note.authorName}</strong><small>{new Date(note.createdAt).toLocaleString('es-AR')}</small><p>{note.body}</p></article>)}{!readOnly && <form onSubmit={addNote}><textarea name="body" minLength={3} maxLength={2000} placeholder="Agregar contexto, decisión o seguimiento…" required /><button disabled={busy}>Agregar comentario</button></form>}</section>
          <section className="case-evidence"><h3>Evidencia privada</h3>{evidence.length === 0 ? <p>Sin documentos vinculados.</p> : evidence.map((link) => <div key={link.id}><strong>{link.fileName}</strong><small>{link.linkedByName} · {new Date(link.createdAt).toLocaleDateString('es-AR')}</small></div>)}{!readOnly && <form onSubmit={linkEvidence}><select name="documentId" required defaultValue=""><option value="" disabled>Seleccionar documento de Compliance</option>{data.documents.filter((document) => !evidence.some((link) => link.documentId === document.id)).map((document) => <option value={document.id} key={document.id}>{document.fileName}</option>)}</select><button disabled={busy || data.documents.length === 0}>Vincular evidencia</button></form>}</section>
        </>}
      </aside>
    </div>
  </div>;
}
