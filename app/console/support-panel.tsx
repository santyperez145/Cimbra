'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { HELP_ARTICLES } from '@/app/lib/platform/help-center';
import { SUPPORT_CATEGORIES, type SupportCategory, type SupportStatus } from '@/app/lib/platform/support-input';

type SupportCase = {
  id: string; organizationId: string; openedBy: string; openedByName: string; category: SupportCategory;
  subject: string; status: SupportStatus; createdAt: string; updatedAt: string; messageCount: number;
};

type SupportMessage = {
  id: string; caseId: string; authorId: string; authorName: string; authorKind: 'tenant' | 'platform';
  body: string; createdAt: string;
};

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  sandbox: 'Sandbox y límites', api: 'API e integración', console: 'Consola y accesos',
  compliance: 'Cumplimiento', commercial: 'Comercial y contratos', other: 'Otro',
};

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Abierto', pending_cimbra: 'Esperando a Cimbra', pending_tenant: 'Esperando tu respuesta',
  resolved: 'Resuelto', closed: 'Cerrado',
};

function isOpenStatus(status: SupportStatus) {
  return status !== 'resolved' && status !== 'closed';
}

export default function SupportPanel({ readOnly }: { readOnly: boolean }) {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  const loadCases = useCallback(async (preferredId?: string) => {
    const response = await authenticatedFetch('/api/v1/support/cases');
    const result = await response.json() as { data?: SupportCase[]; error?: string | { message?: string } };
    if (!response.ok || !result.data) {
      setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar los casos de soporte.');
      return [] as SupportCase[];
    }
    setCases(result.data);
    setSelectedId((current) => {
      const target = preferredId ?? current;
      if (target && result.data!.some((item) => item.id === target)) return target;
      return result.data!.find((item) => isOpenStatus(item.status))?.id ?? result.data![0]?.id ?? '';
    });
    return result.data;
  }, []);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/v1/support/cases').then(async (response) => {
      const result = await response.json() as { data?: SupportCase[]; error?: string | { message?: string } };
      if (!active) return;
      if (!response.ok || !result.data) {
        setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar los casos de soporte.');
      } else {
        setCases(result.data);
        setSelectedId((current) => {
          if (current && result.data!.some((item) => item.id === current)) return current;
          return result.data!.find((item) => isOpenStatus(item.status))?.id ?? result.data![0]?.id ?? '';
        });
      }
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con soporte.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void authenticatedFetch(`/api/v1/support/cases/${selectedId}`).then(async (response) => {
      const result = await response.json() as { data?: { case: SupportCase; messages: SupportMessage[] }; error?: string };
      if (!active) return;
      if (response.ok && result.data) setMessages(result.data.messages);
      else setFeedback(result.error ?? 'No pudimos abrir el caso.');
    }).catch(() => { if (active) setFeedback('No pudimos conectar con soporte.'); });
    return () => { active = false; };
  }, [selectedId]);

  async function openCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/support/cases', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ category: values.get('category'), subject: values.get('subject'), message: values.get('message') }),
    });
    const result = await response.json() as { case?: SupportCase; error?: string | { message?: string } };
    if (response.ok) {
      form.reset(); setComposing(false); setFeedback('Caso abierto. Queda registrado con auditoría y aviso a la plataforma.');
      await loadCases(result.case?.id);
    } else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos abrir el caso.');
    setBusy(false);
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedId) return;
    const form = event.currentTarget; const body = new FormData(form).get('body');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/support/cases/${selectedId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ body }),
    });
    const result = await response.json() as { messages?: SupportMessage[]; error?: string | { message?: string } };
    if (response.ok && result.messages) { form.reset(); setMessages(result.messages); await loadCases(selectedId); setFeedback('Mensaje enviado.'); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos enviar el mensaje.');
    setBusy(false);
  }

  async function changeStatus(status: SupportStatus) {
    if (!selectedId) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/support/cases/${selectedId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ status }),
    });
    const result = await response.json() as { messages?: SupportMessage[]; error?: string | { message?: string } };
    if (response.ok) { if (result.messages) setMessages(result.messages); await loadCases(selectedId); setFeedback(`Caso marcado como ${STATUS_LABELS[status].toLowerCase()}.`); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cambiar el estado.');
    setBusy(false);
  }

  const visible = cases.filter((item) => filter === 'all' || isOpenStatus(item.status));
  const selected = cases.find((item) => item.id === selectedId) ?? null;
  const openCount = cases.filter((item) => isOpenStatus(item.status)).length;
  const waitingOnCimbra = cases.filter((item) => item.status === 'pending_cimbra' || item.status === 'open').length;

  return <div className="module-view operations-view">
    <div className="module-view-head">
      <div><p>SOPORTE</p><h1>Casos y centro de ayuda</h1><span>Cada caso queda auditado en tu tenant y visible para la superadministración de Cimbra.</span></div>
      {!readOnly && <button className="app-primary" onClick={() => setComposing((value) => !value)}>{composing ? 'Cancelar' : '+ Abrir caso'}</button>}
    </div>
    <div className="module-metrics">
      <article><strong>{openCount}</strong><span>casos abiertos</span></article>
      <article><strong>{waitingOnCimbra}</strong><span>esperando a Cimbra</span></article>
      <article><strong>{cases.length}</strong><span>casos históricos</span></article>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {composing && !readOnly && <form className="case-form support-compose" onSubmit={openCase}>
      <div>
        <label>Categoría<select name="category" defaultValue="sandbox">{SUPPORT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
        <label>Asunto<input name="subject" minLength={4} maxLength={140} placeholder="Ej. El webhook de payouts no reintenta" required /></label>
      </div>
      <label>Detalle<textarea name="message" minLength={8} maxLength={4000} placeholder="Contá qué esperabas, qué ocurrió y con qué request id." required /></label>
      <div className="case-actions"><button disabled={busy}>Abrir caso</button></div>
    </form>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar"><div><button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Abiertos</button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button></div></div>
        {busy && cases.length === 0 ? <p className="operations-empty">Cargando casos…</p> : visible.length === 0
          ? <p className="operations-empty">{cases.length === 0 ? 'No abriste casos todavía.' : 'No hay casos para este filtro.'}</p>
          : visible.map((item) => <button key={item.id} className={`work-item-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setMessages([]); }}>
            <span className={`work-priority ${isOpenStatus(item.status) ? 'high' : 'low'}`} />
            <span><strong>{item.subject}</strong><small>{CATEGORY_LABELS[item.category]} · {item.openedByName}</small></span>
            <span><b>{item.messageCount}</b><small>mensajes</small></span>
            <em className={isOpenStatus(item.status) ? 'sla-on_track' : 'sla-none'}>{STATUS_LABELS[item.status]}</em>
          </button>)}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná un caso para ver la conversación.</p> : <>
          <div className="operations-detail-head"><div><small>{CATEGORY_LABELS[selected.category].toUpperCase()}</small><h2>{selected.subject}</h2><p>{selected.id}</p></div><span className={`priority-badge ${isOpenStatus(selected.status) ? 'high' : 'low'}`}>{STATUS_LABELS[selected.status]}</span></div>
          <div className="case-facts">
            <span><small>Abierto por</small><strong>{selected.openedByName}</strong></span>
            <span><small>Creado</small><strong>{new Date(selected.createdAt).toLocaleString('es-AR')}</strong></span>
            <span><small>Última actividad</small><strong>{new Date(selected.updatedAt).toLocaleString('es-AR')}</strong></span>
          </div>
          <section className="case-thread">
            <h3>Conversación</h3>
            {messages.length === 0 ? <p>Sin mensajes.</p> : messages.map((message) => <article key={message.id} className={message.authorKind === 'platform' ? 'support-platform' : undefined}>
              <strong>{message.authorName}{message.authorKind === 'platform' ? ' · Cimbra' : ''}</strong>
              <small>{new Date(message.createdAt).toLocaleString('es-AR')}</small>
              <p>{message.body}</p>
            </article>)}
            {!readOnly && isOpenStatus(selected.status) && <form onSubmit={reply}>
              <textarea name="body" minLength={3} maxLength={4000} placeholder="Escribí tu respuesta…" required />
              <button disabled={busy}>Responder</button>
            </form>}
            {!readOnly && <div className="case-actions">
              {isOpenStatus(selected.status)
                ? <><button type="button" disabled={busy} onClick={() => changeStatus('resolved')}>Marcar resuelto</button><button type="button" className="secondary" disabled={busy} onClick={() => changeStatus('closed')}>Cerrar caso</button></>
                : <button type="button" className="secondary" disabled={busy} onClick={() => changeStatus('open')}>Reabrir caso</button>}
            </div>}
          </section>
        </>}
      </aside>
    </div>
    <article className="module-list help-center">
      <div className="card-head"><div><h2>Centro de ayuda</h2><p>Respuestas honestas sobre los límites reales de la plataforma</p></div><b>DOCUMENTADO</b></div>
      {HELP_ARTICLES.map((article) => <details key={article.id}><summary><strong>{article.title}</strong><small>{article.summary}</small></summary><p>{article.body}</p></details>)}
    </article>
  </div>;
}
