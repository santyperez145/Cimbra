'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import type { DashboardData } from '@/db/runtime';

type Biller = { id: string; code: string; name: string; country: string; category: string; serviceType: 'bill_payment' | 'mobile_topup' | 'gift_card'; currency: string; amountMode: 'exact' | 'range' | 'fixed'; minAmount: number | null; maxAmount: number | null; status: 'active' | 'suspended'; contractReference: string | null };
type Obligation = { id: string; externalReference: string; subscriberReferenceLast4: string; amount: number; currency: string; dueAt: string; description: string; status: 'open' | 'paid' | 'cancelled' | 'expired' };
type Order = { id: string; billerName: string; accountReference: string; serviceType: Biller['serviceType']; destinationReferenceLast4: string; amount: number; currency: string; status: 'declined' | 'review' | 'settled' | 'reversed' | 'cancelled' };
type Mandate = { id: string; billerName: string; serviceType: Biller['serviceType']; accountReference: string; subscriberReferenceLast4: string; frequency: 'weekly' | 'monthly'; amount: number | null; amountLimit: number; currency: string; consentReference: string; status: 'active' | 'paused' | 'cancelled' | 'expired'; nextChargeAt: string; retryCount: number; maxRetries: number };
type MandateExecution = { id: string; mandateId: string; orderId: string | null; scheduledFor: string; attemptNumber: number; status: string; errorCode: string | null; attemptedAt: string };

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function apiError(body: { error?: string | { message?: string } }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

function localDateInput(date = new Date(Date.now() + 24 * 60 * 60 * 1_000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16);
}

export default function BillersPanel({ accounts, actorRole }: { accounts: DashboardData['accounts']; actorRole: OrganizationRole }) {
  const [billers, setBillers] = useState<Biller[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [mandates, setMandates] = useState<Mandate[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]); const [selectedId, setSelectedId] = useState('');
  const [selectedMandateId, setSelectedMandateId] = useState(''); const [executions, setExecutions] = useState<MandateExecution[]>([]);
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const [serviceType, setServiceType] = useState<Biller['serviceType']>('bill_payment');
  const [amountMode, setAmountMode] = useState<Biller['amountMode']>('exact');
  const canOperate = roleCan(actorRole, 'finance.write'); const canManage = roleCan(actorRole, 'billers.manage');
  const selected = useMemo(() => billers.find((item) => item.id === selectedId) ?? billers[0] ?? null, [billers, selectedId]);

  const load = useCallback(async () => {
    const [billersResponse, ordersResponse, mandatesResponse] = await Promise.all([
      authenticatedFetch('/api/v1/billers', { cache: 'no-store' }), authenticatedFetch('/api/v1/bill-payments', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/recurring-mandates', { cache: 'no-store' }),
    ]);
    const billerBody = await billersResponse.json() as { data?: Biller[]; error?: string | { message?: string } };
    const orderBody = await ordersResponse.json() as { data?: Order[]; error?: string | { message?: string } };
    const mandateBody = await mandatesResponse.json() as { data?: Mandate[]; error?: string | { message?: string } };
    if (!billersResponse.ok || !ordersResponse.ok || !mandatesResponse.ok) return setFeedback(apiError(!billersResponse.ok ? billerBody : !ordersResponse.ok ? orderBody : mandateBody));
    setBillers(billerBody.data ?? []); setOrders(orderBody.data ?? []); setMandates(mandateBody.data ?? []);
    setSelectedId((current) => current && billerBody.data?.some((item) => item.id === current) ? current : billerBody.data?.[0]?.id ?? '');
  }, []);

  const loadExecutions = useCallback(async (mandateId: string) => {
    setSelectedMandateId(mandateId);
    const response = await authenticatedFetch(`/api/v1/recurring-mandates/${mandateId}/executions?limit=20`, { cache: 'no-store' });
    const body = await response.json() as { data?: MandateExecution[]; error?: string | { message?: string } };
    if (!response.ok) return setFeedback(apiError(body));
    setExecutions(body.data ?? []);
  }, []);

  const loadObligations = useCallback(async (billerId: string) => {
    if (!billerId) return setObligations([]);
    const response = await authenticatedFetch(`/api/v1/billers/${billerId}/obligations`, { cache: 'no-store' });
    const body = await response.json() as { data?: Obligation[]; error?: string | { message?: string } };
    if (!response.ok) return setFeedback(apiError(body)); setObligations(body.data ?? []);
  }, []);

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);
  useEffect(() => { const task = window.setTimeout(() => void loadObligations(selected?.id ?? ''), 0); return () => window.clearTimeout(task); }, [loadObligations, selected?.id]);

  async function mutation(path: string, body: Record<string, unknown>) {
    setBusy(true); setFeedback('');
    try {
      const response = await authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const result = await response.json() as { requiresApproval?: boolean; error?: string | { message?: string } };
      if (!response.ok) setFeedback(apiError(result));
      else if (result.requiresApproval) setFeedback('Solicitud enviada a Aprobaciones (maker/checker).');
      else setFeedback('Operación registrada con idempotencia, auditoría y eventos.');
      if (response.ok) { await load(); await loadObligations(selected?.id ?? ''); }
      return response.ok;
    } catch {
      setFeedback('No pudimos conectar con la API. Reintentá cuando el servicio esté disponible.');
      return false;
    } finally { setBusy(false); }
  }

  async function createBiller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await mutation('/api/v1/billers', { code: form.get('code'), name: form.get('name'), country: form.get('country'), category: form.get('category'),
      serviceType, currency: form.get('currency'), amountMode,
      minAmount: serviceType === 'bill_payment' ? undefined : form.get('minAmount'), maxAmount: serviceType === 'bill_payment' ? undefined : form.get('maxAmount'),
      contractReference: form.get('contractReference') || undefined });
    if (ok) event.currentTarget.reset();
  }

  async function createObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const ok = await mutation(`/api/v1/billers/${selected.id}/obligations`, { externalReference: form.get('externalReference'), subscriberReference: form.get('subscriberReference'),
      amount: form.get('amount'), dueAt: new Date(String(form.get('dueAt'))).toISOString(), description: form.get('description') });
    if (ok) event.currentTarget.reset();
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const ok = await mutation('/api/v1/bill-payments', { billerId: selected.id, accountId: form.get('accountId'),
      obligationId: selected.serviceType === 'bill_payment' ? form.get('obligationId') : undefined,
      destinationReference: selected.serviceType === 'bill_payment' ? undefined : form.get('destinationReference'),
      amount: selected.serviceType === 'bill_payment' ? undefined : form.get('amount') });
    if (ok) event.currentTarget.reset();
  }

  async function createMandate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const ok = await mutation('/api/v1/recurring-mandates', { billerId: selected.id, accountId: form.get('accountId'), subscriberReference: form.get('subscriberReference'),
      frequency: form.get('frequency'), amount: selected.serviceType === 'bill_payment' ? undefined : form.get('amount'), amountLimit: form.get('amountLimit'),
      consentReference: form.get('consentReference'), consentedAt: new Date().toISOString(), nextChargeAt: new Date(String(form.get('nextChargeAt'))).toISOString(), maxRetries: 3 });
    if (ok) event.currentTarget.reset();
  }

  if (!billers.length && !canManage && !feedback) return <div className="module-view"><div className="module-view-head"><div><p>BILLER INFRASTRUCTURE</p><h1>Servicios y recargas</h1><span>No hay catálogo habilitado para consultar.</span></div></div></div>;

  return <div className="module-view billers-console">
    <div className="module-view-head"><div><p>BILL PAYMENTS · TOP-UPS · RECURRING</p><h1>Servicios y recargas</h1><span>Catálogo propio, deuda emitida, órdenes ledger-backed y mandatos con consentimiento.</span></div><span className="module-health"><i /> Sandbox nativo</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{billers.filter((item) => item.status === 'active').length}</strong><span>billers activos</span></article><article><strong>{obligations.filter((item) => item.status === 'open').length}</strong><span>deudas abiertas · seleccionado</span></article><article><strong>{orders.filter((item) => item.status === 'settled').length}</strong><span>órdenes liquidadas</span></article><article><strong>{mandates.filter((item) => item.status === 'active').length}</strong><span>mandatos activos</span></article></div>
    <div className="biller-workspace">
      <article className="integration-card biller-catalog"><div className="card-head"><div><h2>Catálogo contratado</h2><p>Una identidad por país y servicio</p></div><b>{billers.length}</b></div>
        {billers.length === 0 ? <div className="card-empty"><strong>Sin billers</strong><span>Owner o admin puede registrar el primer convenio directo.</span></div> : <div className="biller-list">{billers.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{item.code} · {item.country} · {item.serviceType} · {item.currency}</small></span><b className={item.status}>{item.status}</b></button>)}</div>}
        {selected && canManage && <div className="biller-lifecycle"><span><strong>{selected.status === 'active' ? 'Disponible para operar' : 'Operación suspendida'}</strong><small>El cambio se audita y emite como evento.</small></span><button disabled={busy} onClick={() => void mutation(`/api/v1/billers/${selected.id}/status`, { action: selected.status === 'active' ? 'suspend' : 'activate' })}>{selected.status === 'active' ? 'Suspender' : 'Activar'}</button></div>}
      </article>
      {canManage && <article className="integration-card"><div className="card-head"><div><h2>Registrar biller</h2><p>Convenio propio, sin agregadores fintech</p></div><b>DIRECT</b></div><form className="integration-form" onSubmit={createBiller}><div className="integration-fields"><label>Código<input name="code" minLength={2} maxLength={40} placeholder="ENERGIA_AR" required /></label><label>Nombre<input name="name" minLength={2} maxLength={160} required /></label></div><div className="integration-fields"><label>Producto<select value={serviceType} onChange={(event) => { const next = event.target.value as Biller['serviceType']; setServiceType(next); setAmountMode(next === 'bill_payment' ? 'exact' : 'range'); }}><option value="bill_payment">Pago de servicios</option><option value="mobile_topup">Recarga móvil</option><option value="gift_card">Gift card</option></select></label><label>Categoría<select name="category"><option value="utilities">Servicios públicos</option><option value="telecom">Telecom</option><option value="tax">Impuestos</option><option value="education">Educación</option><option value="health">Salud</option><option value="insurance">Seguros</option><option value="transport">Transporte</option><option value="entertainment">Entretenimiento</option><option value="other">Otro</option></select></label></div><div className="integration-fields"><label>País<select name="country"><option>AR</option><option>MX</option><option>CO</option><option>BR</option><option>CL</option><option>PE</option></select></label><label>Moneda<select name="currency"><option>ARS</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option><option>USD</option></select></label></div>{serviceType !== 'bill_payment' && <><label>Modalidad<select value={amountMode} onChange={(event) => setAmountMode(event.target.value as Biller['amountMode'])}><option value="range">Rango permitido</option><option value="fixed">Monto fijo</option></select></label><div className="integration-fields"><label>{amountMode === 'fixed' ? 'Monto fijo' : 'Mínimo'}<input name="minAmount" type="number" min="0.01" step="0.01" required /></label>{amountMode === 'range' && <label>Máximo<input name="maxAmount" type="number" min="0.01" step="0.01" required /></label>}</div></>}<label>Referencia contractual<input name="contractReference" placeholder="Contrato directo o sandbox interno" minLength={3} /></label><button disabled={busy}>Registrar biller</button></form></article>}
    </div>
    {selected && <><div className="compliance-onboarding-grid">
      {selected.serviceType === 'bill_payment' && canManage && selected.status === 'active' && <article className="integration-card"><div className="card-head"><div><h2>Emitir obligación</h2><p>La deuda nace del biller integrado</p></div><b>{selected.currency}</b></div><form className="integration-form" onSubmit={createObligation}><div className="integration-fields"><label>Referencia externa<input name="externalReference" minLength={2} required /></label><label>Suscriptor<input name="subscriberReference" minLength={4} autoComplete="off" required /></label></div><div className="integration-fields"><label>Monto<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Vencimiento<input name="dueAt" type="datetime-local" defaultValue={localDateInput()} required /></label></div><label>Descripción<input name="description" minLength={2} maxLength={240} required /></label><button disabled={busy}>Emitir deuda</button><small>La referencia completa se hashea; sólo se expone su terminación.</small></form></article>}
      {canOperate && selected.status === 'active' && <article className="integration-card"><div className="card-head"><div><h2>{selected.serviceType === 'bill_payment' ? 'Pagar obligación' : 'Ejecutar recarga'}</h2><p>Ledger, riesgo y conciliación compartidos</p></div><b>POSTING</b></div><form className="integration-form" onSubmit={createPayment}><label>Cuenta<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar cuenta</option>{accounts.filter((account) => account.currency === selected.currency && account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {account.currency}</option>)}</select></label>{selected.serviceType === 'bill_payment' ? <label>Obligación<select name="obligationId" required defaultValue=""><option value="" disabled>Seleccionar deuda abierta</option>{obligations.filter((item) => item.status === 'open').map((item) => <option key={item.id} value={item.id}>{item.externalReference} · •••• {item.subscriberReferenceLast4} · {money(item.amount, item.currency)}</option>)}</select></label> : <><label>Destino<input name="destinationReference" minLength={4} autoComplete="off" placeholder="Línea o identificador" required /></label><label>Monto<input name="amount" type="number" min={selected.minAmount ?? 0.01} max={selected.maxAmount ?? 10000000} step="0.01" required /></label></>}<button disabled={busy || accounts.filter((account) => account.currency === selected.currency && account.status === 'active').length === 0}>Procesar</button></form></article>}
    </div>
    <div className="compliance-onboarding-grid">
      {canOperate && selected.status === 'active' && <article className="integration-card"><div className="card-head"><div><h2>Nuevo mandato</h2><p>Consentimiento declarado y límite operativo</p></div><b>RECURRING</b></div><form className="integration-form" onSubmit={createMandate}><label>Cuenta<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar cuenta</option>{accounts.filter((account) => account.currency === selected.currency && account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {account.currency}</option>)}</select></label><div className="integration-fields"><label>Suscriptor/destino<input name="subscriberReference" minLength={4} autoComplete="off" required /></label><label>Frecuencia<select name="frequency"><option value="monthly">Mensual</option><option value="weekly">Semanal</option></select></label></div>{selected.serviceType !== 'bill_payment' && <label>Monto por ejecución<input name="amount" type="number" min={selected.minAmount ?? 0.01} max={selected.maxAmount ?? 10000000} step="0.01" required /></label>}<div className="integration-fields"><label>Límite por ejecución<input name="amountLimit" type="number" min="0.01" step="0.01" required /></label><label>Próxima ejecución<input name="nextChargeAt" type="datetime-local" defaultValue={localDateInput()} required /></label></div><label>Referencia de consentimiento<input name="consentReference" minLength={3} maxLength={120} placeholder="CONSENT-2026-001" required /></label><button disabled={busy}>Crear mandato</button><small>En producción deberá validarse contra el consentimiento y riel oficial aplicable.</small></form></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Deudas del biller</h2><p>Estado canónico, no respuesta simulada</p></div><b>{obligations.length}</b></div><div className="integration-list compact-list">{obligations.length === 0 ? <p>Sin obligaciones emitidas.</p> : obligations.slice(0, 10).map((item) => <div key={item.id}><span><strong>{item.description}</strong><small>{item.externalReference} · •••• {item.subscriberReferenceLast4} · vence {new Date(item.dueAt).toLocaleDateString('es-AR')}</small></span><b className={item.status}>{money(item.amount, item.currency)} · {item.status}</b></div>)}</div></article>
    </div></>}
    <div className="compliance-onboarding-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Órdenes recientes</h2><p>Resultado financiero y lifecycle</p></div><b>{orders.length}</b></div><div className="integration-list compact-list">{orders.length === 0 ? <p>Sin órdenes procesadas.</p> : orders.slice(0, 12).map((item) => <div key={item.id}><span><strong>{item.billerName}</strong><small>{item.serviceType} · cuenta {item.accountReference} · destino •••• {item.destinationReferenceLast4}</small></span><b className={item.status}>{money(item.amount, item.currency)} · {item.status}</b>{canOperate && item.status === 'settled' && <button disabled={busy} onClick={() => void mutation(`/api/v1/bill-payments/${item.id}/reverse`, {})}>Revertir</button>}</div>)}</div></article>
      <article className="integration-card"><div className="card-head"><div><h2>Mandatos</h2><p>Agenda, límites, reintentos y ejecuciones</p></div><b>{mandates.length}</b></div><div className="integration-list compact-list">{mandates.length === 0 ? <p>Sin mandatos recurrentes.</p> : mandates.slice(0, 12).map((item) => <div key={item.id}><span><strong>{item.billerName}</strong><small>{item.frequency} · •••• {item.subscriberReferenceLast4} · próxima {new Date(item.nextChargeAt).toLocaleString('es-AR')} · límite {money(item.amountLimit, item.currency)}</small></span><b className={item.status}>{item.status}</b><button type="button" disabled={busy} onClick={() => void loadExecutions(item.id)}>Ejecuciones</button>{canOperate && item.status === 'active' && <><button disabled={busy} onClick={() => void mutation(`/api/v1/recurring-mandates/${item.id}/status`, { action: 'pause' })}>Pausar</button><button disabled={busy} onClick={() => void mutation(`/api/v1/recurring-mandates/${item.id}/status`, { action: 'cancel' })}>Cancelar</button></>}{canOperate && item.status === 'paused' && <button disabled={busy} onClick={() => void mutation(`/api/v1/recurring-mandates/${item.id}/status`, { action: 'resume' })}>Reanudar</button>}</div>)}{selectedMandateId && <div className="integration-list compact-list"><p><strong>Ejecuciones</strong> · mandato {selectedMandateId.slice(0, 8)}…</p>{executions.length === 0 ? <p>Sin intentos registrados todavía.</p> : executions.map((item) => <div key={item.id}><span><strong>{item.status}</strong><small>intento {item.attemptNumber} · {new Date(item.attemptedAt).toLocaleString('es-AR')}{item.orderId ? ` · orden ${item.orderId.slice(0, 8)}…` : ''}{item.errorCode ? ` · ${item.errorCode}` : ''}</small></span></div>)}</div>}</div></article>
    </div>
    <div className="card-sandbox-boundary"><strong>Límite operativo honesto</strong><span>El catálogo, las obligaciones, los pagos y mandatos son propiedad de Cimbra y funcionan en sandbox. No existe cobertura comercial, consulta a billers externos, débito automático homologado ni movimiento de fondos reales hasta contratar directamente cada originador y certificar el riel por país.</span></div>
  </div>;
}
