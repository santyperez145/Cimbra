'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { ORGANIZATION_COUNTRIES } from '@/app/lib/platform/support-input';

type CustomerType = 'individual' | 'business';
type Customer = {
  id: string; type: CustomerType; name: string; country: string; taxIdLast4: string; status: string; createdAt: string;
};

const COUNTRY_LABELS: Record<string, string> = {
  AR: 'Argentina', MX: 'México', CO: 'Colombia', BR: 'Brasil', CL: 'Chile', PE: 'Perú',
};
const TYPE_LABELS: Record<CustomerType, string> = { individual: 'Persona', business: 'Empresa' };

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

export default function CustomersPanel({ role }: { role: OrganizationRole }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Customer | null>(null);
  const [filter, setFilter] = useState<'all' | CustomerType>('all');
  const [query, setQuery] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');
  const canWrite = roleCan(role, 'finance.write');

  const loadPage = useCallback(async (cursor: string) => {
    const params = new URLSearchParams({ limit: '50', cursor });
    const response = await authenticatedFetch(`/api/v1/customers?${params}`, { cache: 'no-store' });
    const result = await response.json() as { data?: Customer[]; nextCursor?: string | null; error?: unknown };
    if (!response.ok || !result.data) throw new Error(apiError(result, 'No pudimos cargar los clientes.'));
    setCustomers((current) => [...current, ...result.data!]);
    setNextCursor(result.nextCursor ?? null);
    setSelectedId((current) => current || result.data![0]?.id || '');
    return result.data;
  }, []);

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/v1/customers?limit=50', { cache: 'no-store' }).then(async (response) => {
      const result = await response.json() as { data?: Customer[]; nextCursor?: string | null; error?: unknown };
      if (!active) return;
      if (!response.ok || !result.data) setFeedback(apiError(result, 'No pudimos cargar los clientes.'));
      else {
        setCustomers(result.data);
        setNextCursor(result.nextCursor ?? null);
        setSelectedId((current) => current && result.data!.some((item) => item.id === current) ? current : result.data![0]?.id ?? '');
      }
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con el padrón de clientes.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void authenticatedFetch(`/api/v1/customers/${selectedId}`, { cache: 'no-store' }).then(async (response) => {
      const result = await response.json() as Customer & { error?: unknown };
      if (!active) return;
      if (response.ok && result.id) setDetail(result);
      else setFeedback(apiError(result, 'No pudimos abrir el cliente.'));
    }).catch(() => { if (active) setFeedback('No pudimos conectar con el padrón de clientes.'); });
    return () => { active = false; };
  }, [selectedId]);

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        type: values.get('type'), name: values.get('name'), country: values.get('country'), taxId: values.get('taxId'),
      }),
    });
    const result = await response.json() as { customer?: Customer; replayed?: boolean; error?: unknown };
    if (response.ok && result.customer) {
      form.reset();
      setComposing(false);
      setCustomers((current) => [result.customer!, ...current.filter((item) => item.id !== result.customer!.id)]);
      setSelectedId(result.customer.id);
      setFeedback(result.replayed
        ? 'Esa alta ya existía: la clave de idempotencia evitó un duplicado.'
        : 'Cliente persistido. Sólo se guarda el last4 del identificador fiscal; no hay consulta a AFIP ni registro mercantil.');
    } else setFeedback(apiError(result, 'No pudimos dar de alta el cliente.'));
    setBusy(false);
  }

  const visible = customers.filter((item) => {
    if (filter !== 'all' && item.type !== filter) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${item.name} ${item.id} ${item.taxIdLast4} ${item.country}`.toLowerCase().includes(needle);
  });
  const selected = detail && detail.id === selectedId ? detail : customers.find((item) => item.id === selectedId) ?? null;
  const people = customers.filter((item) => item.type === 'individual').length;
  const businesses = customers.filter((item) => item.type === 'business').length;

  return <div className="module-view operations-view">
    <div className="module-view-head">
      <div>
        <p>CUSTOMERS</p>
        <h1>Padrón de clientes</h1>
        <span>Personas y empresas del tenant. El expediente KYC/KYB se abre en Compliance; este padrón no consulta registros oficiales.</span>
      </div>
      {canWrite && <button className="app-primary" onClick={() => setComposing((value) => !value)}>{composing ? 'Cancelar' : '+ Nuevo cliente'}</button>}
    </div>
    <div className="module-metrics">
      <article><strong>{customers.length}</strong><span>clientes cargados</span></article>
      <article><strong>{people}</strong><span>personas</span></article>
      <article><strong>{businesses}</strong><span>empresas</span></article>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {composing && canWrite && <form className="case-form support-compose" onSubmit={createCustomer}>
      <div>
        <label>Tipo<select name="type" defaultValue="individual"><option value="individual">Persona</option><option value="business">Empresa</option></select></label>
        <label>País<select name="country" defaultValue="AR">{ORGANIZATION_COUNTRIES.map((country) => <option key={country} value={country}>{COUNTRY_LABELS[country]}</option>)}</select></label>
      </div>
      <div>
        <label>Nombre legal<input name="name" minLength={2} maxLength={140} placeholder="Ej. Comercio Sur S.A." required /></label>
        <label>CUIT / CUIL / RFC<input name="taxId" inputMode="numeric" minLength={4} maxLength={20} placeholder="Sólo dígitos; se persiste el last4" required /></label>
      </div>
      <div className="case-actions"><button disabled={busy}>Dar de alta</button></div>
    </form>}
    {!canWrite && <p className="operations-empty">Tu rol puede consultar el padrón pero no crear clientes. Pedí el alta a un operator, admin u owner.</p>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar">
          <input aria-label="Buscar cliente" placeholder="⌕ Nombre, last4 o id" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div>
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
            <button className={filter === 'individual' ? 'active' : ''} onClick={() => setFilter('individual')}>Personas</button>
            <button className={filter === 'business' ? 'active' : ''} onClick={() => setFilter('business')}>Empresas</button>
          </div>
        </div>
        {busy && customers.length === 0 ? <p className="operations-empty">Cargando clientes…</p> : visible.length === 0
          ? <p className="operations-empty">{customers.length === 0 ? 'Todavía no hay clientes en este tenant.' : 'Ningún cliente coincide con el filtro.'}</p>
          : visible.map((item) => <button key={item.id} className={`work-item-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            <span className={`work-priority ${item.type === 'business' ? 'medium' : 'low'}`} />
            <span><strong>{item.name}</strong><small>{TYPE_LABELS[item.type]} · {COUNTRY_LABELS[item.country] ?? item.country}</small></span>
            <span><b>…{item.taxIdLast4}</b><small>last4</small></span>
            <em className={item.status === 'active' ? 'sla-on_track' : 'sla-none'}>{item.status === 'active' ? 'Activo' : item.status}</em>
          </button>)}
        {nextCursor && <div className="case-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void loadPage(nextCursor).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'No pudimos paginar.')).finally(() => setBusy(false)); }}>Cargar más</button></div>}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná un cliente para ver el registro canónico.</p> : <>
          <div className="operations-detail-head">
            <div><small>{TYPE_LABELS[selected.type].toUpperCase()}</small><h2>{selected.name}</h2><p>{selected.id}</p></div>
            <span className={`priority-badge ${selected.status === 'active' ? 'low' : 'high'}`}>{selected.status === 'active' ? 'Activo' : selected.status}</span>
          </div>
          <div className="case-facts">
            <span><small>Jurisdicción</small><strong>{COUNTRY_LABELS[selected.country] ?? selected.country}</strong></span>
            <span><small>Identificador fiscal</small><strong>****{selected.taxIdLast4}</strong></span>
            <span><small>Alta</small><strong>{new Date(selected.createdAt).toLocaleString('es-AR')}</strong></span>
          </div>
          <section className="case-thread">
            <h3>Límites honestos</h3>
            <p>Cimbra no verifica CUIT/CUIL contra AFIP ni razón social contra un registro mercantil. El last4 alcanza para correlacionar wallets, cuentas y expedientes del tenant. El KYC/KYB se opera en Compliance y no habilita dinero real.</p>
          </section>
        </>}
      </aside>
    </div>
  </div>;
}
