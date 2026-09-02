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

type RailStatus = 'unwired' | 'negotiating' | 'contracted' | 'certified' | 'live';

type Rail = {
  id: string; name: string; counterparty: string; summary: string; status: RailStatus;
  adapterRegistered: boolean; wiringContract: string;
  evidence: {
    evidenceNote: string; counterpartyLegalName: string; counterpartyTaxId: string;
    contractReference: string; safeguardingAccountRef: string;
    dueDiligence: Array<{ checkId: string; status: string; note: string }>;
  };
  dueDiligenceRequiredMet: boolean;
};

type RailsBundle = {
  rails: Rail[];
  sponsorCandidates: Array<{ id: string; label: string; summary: string; rfiTopics: readonly string[] }>;
  dueDiligenceCatalog: Array<{ id: string; required: boolean; name: string; summary: string }>;
  fintechPath: { metCount: number; gateCount: number; intendedFigure: string };
};

type Overview = {
  operator: { email: string; role: string };
  tenants: Tenant[];
  leads: Lead[];
  supportCases: PlatformCase[];
  services: ServiceTopology;
  rails: RailsBundle;
  readiness: {
    effectiveMode: string; liveReady: boolean; blockReason: string | null;
    fintechPath?: { metCount: number; gateCount: number };
  };
};

const STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Abierto', pending_cimbra: 'Esperando a Cimbra', pending_tenant: 'Esperando al tenant',
  resolved: 'Resuelto', closed: 'Cerrado',
};

const LEAD_LABELS: Record<LeadStatus, string> = {
  new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado', closed: 'Cerrado',
};

const RAIL_LABELS: Record<RailStatus, string> = {
  unwired: 'Sin cablear', negotiating: 'Negociando', contracted: 'Contrato',
  certified: 'Certificado', live: 'Live',
};

function isOpenStatus(status: SupportStatus) {
  return status !== 'resolved' && status !== 'closed';
}

function nextRailStatus(status: RailStatus): RailStatus | null {
  const order: RailStatus[] = ['unwired', 'negotiating', 'contracted', 'certified', 'live'];
  const index = order.indexOf(status);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

export default function OpsClient({ operatorEmail }: { operatorEmail: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [section, setSection] = useState<'tenants' | 'support' | 'leads' | 'services' | 'rails'>('rails');
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

  async function saveSponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = new FormData(form);
    const dueDiligence = (data?.rails.dueDiligenceCatalog ?? []).map((check) => ({
      checkId: check.id,
      status: String(payload.get(`dd_${check.id}`) ?? 'pending'),
      note: String(payload.get(`dd_note_${check.id}`) ?? ''),
    }));
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/ops/rails/sponsor_bank', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: payload.get('status'),
        evidenceNote: payload.get('evidenceNote'),
        counterpartyLegalName: payload.get('counterpartyLegalName'),
        counterpartyTaxId: payload.get('counterpartyTaxId'),
        contractReference: payload.get('contractReference'),
        safeguardingAccountRef: payload.get('safeguardingAccountRef'),
        dueDiligence,
      }),
    });
    const result = await response.json() as { error?: string | { message?: string } };
    if (response.ok) { await load(); setFeedback('Banco patrocinante actualizado. El adaptador documental no despacha fondos ni usa bindX.'); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos guardar el sponsor.');
    setBusy(false);
  }

  async function advanceRail(id: string, status: RailStatus) {
    const next = nextRailStatus(status);
    if (!next) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/ops/rails/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
    });
    const result = await response.json() as { error?: string | { message?: string } };
    if (response.ok) { await load(); setFeedback(`${id} pasó a ${RAIL_LABELS[next].toLowerCase()}.`); }
    else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos avanzar el riel.');
    setBusy(false);
  }

  const openCases = data?.supportCases.filter((item) => isOpenStatus(item.status)) ?? [];
  const sponsor = data?.rails.rails.find((rail) => rail.id === 'sponsor_bank');
  const ddById = new Map((sponsor?.evidence.dueDiligence ?? []).map((item) => [item.checkId, item]));

  return <main className="ops-shell">
    <header className="ops-topbar">
      <div><small>CIMBRA / SUPERADMINISTRACIÓN</small><strong>Plano de control multi-tenant</strong></div>
      <div className="ops-operator"><span>{operatorEmail}</span><Link href="/console">Ir a mi consola →</Link></div>
    </header>

    {data && <div className="module-metrics ops-metrics">
      <article><strong>{data.tenants.length}</strong><span>tenants</span></article>
      <article><strong>{openCases.length}</strong><span>casos abiertos</span></article>
      <article><strong>{data.readiness.fintechPath ? `${data.readiness.fintechPath.metCount}/${data.readiness.fintechPath.gateCount}` : '—'}</strong><span>gates PSPCP</span></article>
      <article><strong>{data.readiness.effectiveMode}</strong><span>modo efectivo</span></article>
    </div>}

    {data?.readiness.blockReason && <div className="form-feedback ledger-feedback">{data.readiness.blockReason}</div>}
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}

    <nav className="ops-tabs">
      <button className={section === 'rails' ? 'active' : ''} onClick={() => setSection('rails')}>Sponsor / rieles</button>
      <button className={section === 'tenants' ? 'active' : ''} onClick={() => setSection('tenants')}>Tenants</button>
      <button className={section === 'support' ? 'active' : ''} onClick={() => setSection('support')}>Soporte</button>
      <button className={section === 'leads' ? 'active' : ''} onClick={() => setSection('leads')}>Leads</button>
      <button className={section === 'services' ? 'active' : ''} onClick={() => setSection('services')}>Servicios</button>
    </nav>

    {!data ? <p className="operations-empty">{busy ? 'Cargando plano de control…' : 'Sin datos disponibles.'}</p> : <>
      {section === 'rails' && <div className="operations-layout">
        <article className="operations-detail">
          <div className="operations-detail-head"><div><small>BANCO PATROCINANTE · PSPCP</small><h2>Sponsor bancario del BaaS propio</h2><p>BIND Banco puede ser la entidad financiera patrocinante. BIND PSP / bindX no son el producto.</p></div></div>
          <p className="ops-note">El retainer del sponsor está fuera del envelope de USD 500. Acá registrás negociación y evidencia; liveReady sigue fail-closed hasta hostname, Coelsa y el resto de rieles.</p>
          {(data.rails.sponsorCandidates ?? []).map((candidate) => <details key={candidate.id} open={candidate.id === 'bind_banco_ef'}>
            <summary><strong>{candidate.label}</strong></summary>
            <p>{candidate.summary}</p>
            <ul>{candidate.rfiTopics.map((topic) => <li key={topic}>{topic}</li>)}</ul>
          </details>)}
          {sponsor && <form className="case-thread" onSubmit={saveSponsor}>
            <label>Estado<select name="status" defaultValue={sponsor.status} required>
              {(['unwired', 'negotiating', 'contracted', 'certified', 'live'] as RailStatus[]).map((status) => (
                <option key={status} value={status}>{RAIL_LABELS[status]}</option>
              ))}
            </select></label>
            <label>Razón social del banco<input name="counterpartyLegalName" defaultValue={sponsor.evidence.counterpartyLegalName} maxLength={200} placeholder="Entidad financiera regulada" /></label>
            <label>CUIT / id fiscal<input name="counterpartyTaxId" defaultValue={sponsor.evidence.counterpartyTaxId} maxLength={20} placeholder="30-XXXXXXXX-X" /></label>
            <label>Referencia de contrato<input name="contractReference" defaultValue={sponsor.evidence.contractReference} maxLength={120} placeholder="Contrato-patrocinio-…" /></label>
            <label>Cuenta safeguarding (ref, sin secretos)<input name="safeguardingAccountRef" defaultValue={sponsor.evidence.safeguardingAccountRef} maxLength={120} placeholder="Cuenta a la vista · ref interna" /></label>
            <label>Nota de evidencia<textarea name="evidenceNote" defaultValue={sponsor.evidence.evidenceNote} maxLength={2000} rows={3} /></label>
            <h3>Due diligence del sponsor</h3>
            {(data.rails.dueDiligenceCatalog ?? []).map((check) => {
              const current = ddById.get(check.id);
              return <fieldset key={check.id} className="ops-dd-item">
                <legend>{check.name}{check.required ? ' · requerido' : ''}</legend>
                <p>{check.summary}</p>
                <select name={`dd_${check.id}`} defaultValue={current?.status ?? 'pending'}>
                  <option value="pending">Pendiente</option>
                  <option value="passed">Cumple</option>
                  <option value="failed">No cumple</option>
                  <option value="waived">Waived</option>
                </select>
                <input name={`dd_note_${check.id}`} defaultValue={current?.note ?? ''} maxLength={500} placeholder="Nota breve" />
              </fieldset>;
            })}
            <button disabled={busy}>Guardar sponsor bancario</button>
          </form>}
        </article>
        <aside className="operations-queue">
          <p className="ops-note">Rieles oficiales · {data.rails.fintechPath.metCount}/{data.rails.fintechPath.gateCount} gates PSPCP</p>
          {data.rails.rails.map((rail) => <div key={rail.id} className="work-item-row">
            <span className={`work-priority ${rail.status === 'live' ? 'low' : 'high'}`} />
            <span><strong>{rail.name}</strong><small>{rail.counterparty} · {RAIL_LABELS[rail.status]}{rail.adapterRegistered ? ' · adaptador listo' : ''}</small></span>
            {nextRailStatus(rail.status) && rail.id !== 'sponsor_bank' && (
              <button type="button" disabled={busy} onClick={() => advanceRail(rail.id, rail.status)}>Avanzar</button>
            )}
          </div>)}
        </aside>
      </div>}

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
