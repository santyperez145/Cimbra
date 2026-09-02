'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { LEAD_STATUSES, type LeadStatus, type SupportStatus } from '@/app/lib/platform/support-input';

type Tenant = {
  id: string; name: string; slug: string; country: string; status: string; createdAt: string;
  memberCount: number; openSupportCases: number;
};

type Lead = {
  id: string; name: string; company: string; email: string; volume: string; message: string;
  status: LeadStatus; createdAt: string;
};

type PlatformCase = {
  id: string; organizationId: string; organizationName: string; openedByName: string; category: string;
  subject: string; status: SupportStatus; createdAt: string; updatedAt: string; messageCount: number;
};

type SupportMessage = {
  id: string; caseId: string; authorId: string; authorName: string; authorKind: 'tenant' | 'platform';
  body: string; createdAt: string;
};

type ServiceTopology = {
  services: Array<{
    id: string; name: string; mission: string; runtime: string; ownedTables: number; modules: number;
    extractable: boolean; extractionDebt: Array<{ table: string; owner: string; reason: string }>; extractionGate: string;
  }>;
  totals: { services: number; standalone: number; extractable: number; ownedTables: number; extractionDebt: number };
  posture: string;
};

type Overview = {
  operator: { email: string; role: string };
  tenants: Tenant[];
  leads: Lead[];
  supportCases: PlatformCase[];
  services: ServiceTopology;
  readiness: { effectiveMode: string; liveReady: boolean; blockReason: string | null };
};

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Abierto', pending_cimbra: 'Esperando a Cimbra', pending_tenant: 'Esperando al tenant',
  resolved: 'Resuelto', closed: 'Cerrado',
};

const LEAD_LABELS: Record<LeadStatus, string> = {
  new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado', closed: 'Cerrado',
};

function isOpenStatus(status: SupportStatus) {
  return status !== 'resolved' && status !== 'closed';
}

export default function OpsClient({ operatorEmail }: { operatorEmail: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [section, setSection] = useState<'tenants' | 'support' | 'leads' | 'services'>('tenants');
  const [selectedCase, setSelectedCase] = useState('');
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/ops/overview');
    const result = await response.json() as { data?: Overview; error?: string | { message?: string } };
    if (response.ok && result.data) setData(result.data);
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar la superadministración.');
  }, []);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/ops/overview').then(async (response) => {
      const result = await response.json() as { data?: Overview; error?: string | { message?: string } };
      if (!active) return;
      if (response.ok && result.data) setData(result.data);
      else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar la superadministración.');
    }).catch(() => { if (active) setFeedback('No pudimos conectar con la superadministración.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedCase) return;
    let active = true;
    void authenticatedFetch(`/api/ops/support/cases/${selectedCase}`).then(async (response) => {
      const result = await response.json() as { data?: { messages: SupportMessage[] }; error?: string };
      if (!active) return;
      if (response.ok && result.data) setMessages(result.data.messages);
      else setFeedback(result.error ?? 'No pudimos abrir el caso.');
    }).catch(() => { if (active) setFeedback('No pudimos conectar con el caso.'); });
    return () => { active = false; };
  }, [selectedCase]);

  async function updateLead(id: string, status: LeadStatus) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/ops/leads/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    const result = await response.json() as { error?: string | { message?: string } };
    if (response.ok) { await load(); setFeedback(`Lead marcado como ${LEAD_LABELS[status].toLowerCase()}.`); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos actualizar el lead.');
    setBusy(false);
  }

  async function replyCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedCase) return;
    const form = event.currentTarget; const body = new FormData(form).get('body');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/ops/support/cases/${selectedCase}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    });
    const result = await response.json() as { error?: string | { message?: string } };
    if (response.ok) {
      form.reset();
      const thread = await authenticatedFetch(`/api/ops/support/cases/${selectedCase}`);
      const payload = await thread.json() as { data?: { messages: SupportMessage[] } };
      if (thread.ok && payload.data) setMessages(payload.data.messages);
      await load();
      setFeedback('Respuesta enviada al tenant.');
    }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos responder el caso.');
    setBusy(false);
  }

  async function updateCase(id: string, status: SupportStatus) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/ops/support/cases/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    const result = await response.json() as { error?: string | { message?: string } };
    if (response.ok) { await load(); setFeedback(`Caso marcado como ${STATUS_LABELS[status].toLowerCase()}.`); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cambiar el estado.');
    setBusy(false);
  }

  const openCases = data?.supportCases.filter((item) => isOpenStatus(item.status)) ?? [];
  const newLeads = data?.leads.filter((item) => item.status === 'new') ?? [];

  return <main className="ops-shell">
    <header className="ops-topbar">
      <div><small>CIMBRA / SUPERADMINISTRACIÓN</small><strong>Plano de control multi-tenant</strong></div>
      <div className="ops-operator"><span>{operatorEmail}</span><Link href="/console">Ir a mi consola →</Link></div>
    </header>

    {data && <div className="module-metrics ops-metrics">
      <article><strong>{data.tenants.length}</strong><span>tenants</span></article>
      <article><strong>{openCases.length}</strong><span>casos abiertos</span></article>
      <article><strong>{newLeads.length}</strong><span>leads nuevos</span></article>
      <article><strong>{data.readiness.effectiveMode}</strong><span>modo efectivo</span></article>
    </div>}

    {data?.readiness.blockReason && <div className="form-feedback ledger-feedback">{data.readiness.blockReason}</div>}
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}

    <nav className="ops-tabs">
      <button className={section === 'tenants' ? 'active' : ''} onClick={() => setSection('tenants')}>Tenants</button>
      <button className={section === 'support' ? 'active' : ''} onClick={() => setSection('support')}>Soporte</button>
      <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
      <button className={section === 'services' ? 'active' : ''} onClick={() => setSection('services')}>Servicios</button>
    </nav>

    {!data ? <p className="operations-empty">{busy ? 'Cargando plano de control…' : 'Sin datos disponibles.'}</p> : <>
      {section === 'tenants' && <article className="module-list">
        <div className="card-head"><div><h2>Tenants</h2><p>Organizaciones dadas de alta, sin acceso a sus datos financieros desde esta vista</p></div><b>{data.tenants.length}</b></div>
        {data.tenants.length === 0 ? <div className="table-empty">Todavía no hay organizaciones registradas.</div> : data.tenants.map((tenant) => <div key={tenant.id}>
          <span className="movement"><i>⌂</i><b>{tenant.name}<small>{tenant.slug} · {tenant.country} · alta {new Date(tenant.createdAt).toLocaleDateString('es-AR')}</small></b></span>
          <strong>{tenant.memberCount} miembros{tenant.openSupportCases > 0 ? ` · ${tenant.openSupportCases} casos` : ''}</strong>
        </div>)}
      </article>}

      {section === 'support' && <div className="operations-layout">
        <article className="operations-queue">
          {data.supportCases.length === 0 ? <p className="operations-empty">No hay casos de soporte en ningún tenant.</p> : data.supportCases.map((item) => <button key={item.id} className={`work-item-row ${selectedCase === item.id ? 'selected' : ''}`} onClick={() => { setSelectedCase(item.id); setMessages([]); }}>
            <span className={`work-priority ${isOpenStatus(item.status) ? 'high' : 'low'}`} />
            <span><strong>{item.subject}</strong><small>{item.organizationName} · {item.openedByName}</small></span>
            <span><b>{item.messageCount}</b><small>mensajes</small></span>
            <em className={isOpenStatus(item.status) ? 'sla-on_track' : 'sla-none'}>{STATUS_LABELS[item.status]}</em>
          </button>)}
        </article>
        <aside className="operations-detail">
          {!selectedCase ? <p className="operations-empty">Elegí un caso para responder como Cimbra.</p> : <>
            <div className="operations-detail-head"><div><small>RESPUESTA DE PLATAFORMA</small><h2>{data.supportCases.find((item) => item.id === selectedCase)?.subject}</h2><p>{selectedCase}</p></div></div>
            <p className="ops-note">Tu respuesta queda firmada como Cimbra, mueve el caso a “esperando al tenant” y emite el webhook support.message_added en la organización afectada.</p>
            <section className="case-thread">
              <h3>Conversación</h3>
              {messages.length === 0 ? <p>Sin mensajes cargados.</p> : messages.map((message) => <article key={message.id} className={message.authorKind === 'platform' ? 'support-platform' : undefined}>
                <strong>{message.authorName}{message.authorKind === 'platform' ? ' · Cimbra' : ''}</strong>
                <small>{new Date(message.createdAt).toLocaleString('es-AR')}</small>
                <p>{message.body}</p>
              </article>)}
            </section>
            <form className="case-thread" onSubmit={replyCase}>
              <textarea name="body" minLength={3} maxLength={4000} placeholder="Respuesta al tenant…" required />
              <button disabled={busy}>Responder como Cimbra</button>
            </form>
            <div className="case-actions">
              <button type="button" disabled={busy} onClick={() => updateCase(selectedCase, 'resolved')}>Marcar resuelto</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => updateCase(selectedCase, 'closed')}>Cerrar caso</button>
            </div>
          </>}
        </aside>
      </div>}

      {section === 'leads' && <article className="module-list">
        <div className="card-head"><div><h2>Pipeline comercial</h2><p>Leads reales cargados desde el formulario público, sin tracción inventada</p></div><b>{data.leads.length}</b></div>
        {data.leads.length === 0 ? <div className="table-empty">Todavía no hay leads. El formulario público los registra acá.</div> : data.leads.map((lead) => <div key={lead.id}>
          <span className="movement"><i>◈</i><b>{lead.company || lead.name}<small>{lead.email} · {lead.volume} · {new Date(lead.createdAt).toLocaleDateString('es-AR')}</small></b></span>
          <label className="ops-inline-select">
            <span className="visually-hidden">Estado del lead {lead.company || lead.name}</span>
            <select value={lead.status} disabled={busy} onChange={(event) => updateLead(lead.id, event.target.value as LeadStatus)}>
              {LEAD_STATUSES.map((status) => <option key={status} value={status}>{LEAD_LABELS[status]}</option>)}
            </select>
          </label>
        </div>)}
      </article>}

      {section === 'services' && <>
        <div className="module-metrics">
          <article><strong>{data.services.totals.services}</strong><span>servicios de dominio</span></article>
          <article><strong>{data.services.totals.extractable}</strong><span>extraíbles hoy</span></article>
          <article><strong>{data.services.totals.extractionDebt}</strong><span>escrituras cruzadas</span></article>
          <article><strong>{data.services.totals.ownedTables}</strong><span>tablas con dueño</span></article>
        </div>
        <p className="ops-note">{data.services.posture}</p>
        <article className="module-list">
          <div className="card-head"><div><h2>Catálogo de servicios</h2><p>Cada tabla y módulo pertenece a un servicio; la deuda de extracción es visible y verificada por tests</p></div><b>BOUNDED CONTEXTS</b></div>
          {data.services.services.map((service) => <details key={service.id}>
            <summary><strong>{service.name}</strong><small>{service.ownedTables} tablas · {service.modules} módulos · {service.extractable ? 'extraíble' : `${service.extractionDebt.length} escrituras cruzadas`}</small></summary>
            <p>{service.mission}</p>
            <p><b>Compuerta de extracción:</b> {service.extractionGate}</p>
            {service.extractionDebt.length > 0 && <ul>{service.extractionDebt.map((debt) => <li key={debt.table}><b>{debt.table}</b> pertenece a {debt.owner}: {debt.reason}</li>)}</ul>}
          </details>)}
        </article>
      </>}
    </>}
  </main>;
}
