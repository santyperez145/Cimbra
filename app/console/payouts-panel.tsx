'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; balance: number; status: string };
type Beneficiary = { id: string; externalReference: string; name: string; entityType: 'individual' | 'business'; country: string; currency: string;
  destinationType: string; destinationLast4: string; bankCode: string | null; status: 'active' | 'suspended'; createdAt: string };
type PayoutItem = { id: string; externalReference: string; beneficiaryName: string; amount: number; currency: string; status: string;
  destinationLast4: string; failureCode: string | null };
type Batch = { id: string; sourceAccountId: string; sourceAccountReference: string; externalReference: string; description: string;
  currency: string; status: string; totalAmount: number; itemCount: number; scheduledFor: string | null; processBefore: string | null;
  createdAt: string; items: PayoutItem[] };
type DraftItem = { key: string; externalReference: string; beneficiaryId: string; amount: string; description: string };

const statusLabels: Record<string, string> = { draft: 'Borrador', pending_approval: 'Esperando aprobación', scheduled: 'Programado',
  processing: 'Procesando', requires_attention: 'Requiere revisión', completed: 'Completado', partially_failed: 'Parcial', failed: 'Fallido', cancelled: 'Cancelado',
  pending: 'Pendiente', review: 'En revisión', settled: 'Liquidado' };

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function message(body: { error?: string | { message?: string } }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

function newItem(): DraftItem {
  return { key: crypto.randomUUID(), externalReference: '', beneficiaryId: '', amount: '', description: '' };
}

export default function PayoutsPanel({ accounts, actorRole }: { accounts: Account[]; actorRole: OrganizationRole }) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]); const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<DraftItem[]>([newItem()]); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(actorRole, 'finance.write'); const canManageBeneficiaries = roleCan(actorRole, 'payouts.beneficiaries.manage');
  const activeBeneficiaries = useMemo(() => beneficiaries.filter((item) => item.status === 'active'), [beneficiaries]);

  const load = useCallback(async () => {
    const [beneficiaryResponse, batchResponse] = await Promise.all([
      authenticatedFetch('/api/v1/payout-beneficiaries', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/payout-batches', { cache: 'no-store' }),
    ]);
    const beneficiaryBody = await beneficiaryResponse.json() as { data?: Beneficiary[]; error?: string | { message?: string } };
    const batchBody = await batchResponse.json() as { data?: Batch[]; error?: string | { message?: string } };
    if (!beneficiaryResponse.ok) return setFeedback(message(beneficiaryBody));
    if (!batchResponse.ok) return setFeedback(message(batchBody));
    setBeneficiaries(beneficiaryBody.data ?? []); setBatches(batchBody.data ?? []);
  }, []);

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);

  async function createBeneficiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(''); const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch('/api/v1/payout-beneficiaries', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(Object.fromEntries(form)) });
    const body = await response.json() as { error?: string | { message?: string } };
    setFeedback(response.ok ? 'Beneficiario creado. El destino completo quedó protegido y no se volverá a exponer.' : message(body));
    if (response.ok) { event.currentTarget.reset(); await load(); } setBusy(false);
  }

  async function setBeneficiaryStatus(item: Beneficiary) {
    const action = item.status === 'active' ? 'suspend' : 'activate';
    if (!window.confirm(`${action === 'suspend' ? 'Suspender' : 'Activar'} a ${item.name}?`)) return;
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/payout-beneficiaries/${item.id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action }),
    }); const body = await response.json() as { error?: string | { message?: string } };
    setFeedback(response.ok ? `Beneficiario ${action === 'suspend' ? 'suspendido' : 'activado'}.` : message(body));
    if (response.ok) await load(); setBusy(false);
  }

  function updateItem(key: string, field: keyof Omit<DraftItem, 'key'>, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(''); const form = new FormData(event.currentTarget);
    const scheduledForLocal = String(form.get('scheduledFor') ?? ''); const processBeforeLocal = String(form.get('processBefore') ?? '');
    const payload = { sourceAccountId: form.get('sourceAccountId'), externalReference: form.get('externalReference'), description: form.get('description'),
      currency: form.get('currency'), scheduledFor: scheduledForLocal ? new Date(scheduledForLocal).toISOString() : undefined,
      processBefore: processBeforeLocal ? new Date(processBeforeLocal).toISOString() : undefined,
      items: items.map(({ key, ...item }) => { void key; return item; }) };
    const response = await authenticatedFetch('/api/v1/payout-batches', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
    const body = await response.json() as { error?: string | { message?: string } };
    setFeedback(response.ok ? 'Lote creado como borrador inmutable. Revisalo y envialo cuando esté listo.' : message(body));
    if (response.ok) { event.currentTarget.reset(); setItems([newItem()]); await load(); } setBusy(false);
  }

  async function batchAction(batch: Batch, action: 'submit' | 'cancel') {
    if (!window.confirm(action === 'submit' ? `¿Enviar ${batch.externalReference} para ejecución?` : `¿Cancelar ${batch.externalReference}?`)) return;
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/payout-batches/${batch.id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: action === 'submit' ? '{}' : undefined,
    }); const body = await response.json() as { requiresApproval?: boolean; error?: string | { message?: string } };
    setFeedback(response.ok ? body.requiresApproval ? 'Lote enviado a doble aprobación. Debe decidir otro owner/admin con MFA.'
      : action === 'submit' ? 'Lote aceptado. La ejecución asíncrona comenzó.' : 'Lote cancelado sin débito.' : message(body));
    if (response.ok) { await new Promise((resolve) => window.setTimeout(resolve, action === 'submit' ? 900 : 0)); await load(); } setBusy(false);
  }

  async function downloadResult(batch: Batch) {
    const response = await authenticatedFetch(`/api/v1/payout-batches/${batch.id}/result`, { cache: 'no-store' });
    if (!response.ok) { const body = await response.json() as { error?: string | { message?: string } }; return setFeedback(message(body)); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `cimbra-payout-${batch.externalReference}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="module-view payouts-console">
    <div className="module-view-head"><div><p>WALLETS & PAYOUTS</p><h1>Beneficiarios y lotes</h1><span>Egresos masivos por ítem con doble control, riesgo, ledger y archivo de resultados.</span></div><span className="module-health"><i /> {batches.filter((item) => ['processing', 'scheduled', 'pending_approval', 'requires_attention'].includes(item.status)).length} activos</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{beneficiaries.length}</strong><span>beneficiarios</span></article><article><strong>{batches.length}</strong><span>lotes</span></article><article><strong>{batches.reduce((sum, batch) => sum + batch.itemCount, 0)}</strong><span>ítems procesables</span></article></div>
    <div className="approval-layout">
      {canManageBeneficiaries && <article className="integration-card"><div className="card-head"><div><h2>Nuevo beneficiario</h2><p>El destino se protege antes de persistir</p></div><b>OWNER / ADMIN</b></div><form className="integration-form" onSubmit={createBeneficiary}>
        <div className="integration-fields"><label>Referencia<input name="externalReference" required placeholder="PROVIDER-001" /></label><label>Nombre<input name="name" required minLength={2} placeholder="Proveedor Regional" /></label></div>
        <div className="integration-fields"><label>Tipo<select name="entityType"><option value="business">Empresa</option><option value="individual">Persona</option></select></label><label>País<input name="country" required pattern="[A-Za-z]{2}" defaultValue="AR" /></label></div>
        <div className="integration-fields"><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label><label>Tipo de destino<select name="destinationType"><option value="alias">Alias</option><option value="local_account">Cuenta local</option><option value="iban">IBAN</option><option value="clabe">CLABE</option><option value="pix_key">Pix key</option></select></label></div>
        <label>Destino<input name="destination" required minLength={4} placeholder="alias, cuenta, IBAN, CLABE o Pix key" autoComplete="off" /></label><label>Código bancario (opcional)<input name="bankCode" placeholder="Identificador directo del banco" /></label>
        <button disabled={busy}>Crear beneficiario</button></form></article>}
      {canOperate && <article className="integration-card"><div className="card-head"><div><h2>Nuevo lote</h2><p>De 1 a 100 ítems, sin edición después del alta</p></div><b>ASYNC</b></div><form className="integration-form" onSubmit={createBatch}>
        <div className="integration-fields"><label>Cuenta<select name="sourceAccountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{accounts.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.accountReference} · {item.currency} · {money(item.balance, item.currency)}</option>)}</select></label><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>
        <label>Referencia del lote<input name="externalReference" required placeholder="PAYOUT-2026-09-001" /></label><label>Descripción<input name="description" required minLength={2} placeholder="Liquidación de proveedores" /></label>
        <div className="integration-fields"><label>Programar (opcional)<input name="scheduledFor" type="datetime-local" /></label><label>Procesar antes de (opcional)<input name="processBefore" type="datetime-local" /></label></div>
        <fieldset><legend>Ítems del lote</legend>{items.map((item, index) => <div className="payout-item-form" key={item.key}><strong>Ítem {index + 1}</strong><div className="integration-fields"><label>Referencia<input required value={item.externalReference} onChange={(event) => updateItem(item.key, 'externalReference', event.target.value)} placeholder={`ITEM-${index + 1}`} /></label><label>Beneficiario<select required value={item.beneficiaryId} onChange={(event) => updateItem(item.key, 'beneficiaryId', event.target.value)}><option value="" disabled>Seleccionar</option>{activeBeneficiaries.map((beneficiary) => <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.name} · {beneficiary.currency} · ••••{beneficiary.destinationLast4}</option>)}</select></label></div><div className="integration-fields"><label>Monto<input required type="number" min="0.01" step="0.01" value={item.amount} onChange={(event) => updateItem(item.key, 'amount', event.target.value)} /></label><label>Concepto<input required minLength={2} value={item.description} onChange={(event) => updateItem(item.key, 'description', event.target.value)} /></label></div>{items.length > 1 && <button type="button" className="danger-link" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>Quitar ítem</button>}</div>)}</fieldset>
        <button type="button" disabled={items.length >= 100} onClick={() => setItems((current) => [...current, newItem()])}>+ Agregar ítem</button><button disabled={busy || accounts.length === 0 || activeBeneficiaries.length === 0}>Crear borrador</button>
      </form></article>}
    </div>
    <article className="module-list"><div className="card-head"><div><h2>Beneficiarios</h2><p>Destinos tenant-scoped sin exposición del identificador completo</p></div><b>{beneficiaries.length}</b></div>{beneficiaries.length === 0 ? <div><span className="movement"><i>◎</i><b>Sin beneficiarios<small>{canManageBeneficiaries ? 'Creá el primer destino habilitado' : 'No hay destinos disponibles'}</small></b></span><strong>Vacío</strong></div> : beneficiaries.map((item) => <div key={item.id}><span className="movement"><i>◎</i><b>{item.name}<small>{item.externalReference} · {item.entityType} · {item.country} · {item.currency} · {item.destinationType} ••••{item.destinationLast4}</small></b></span><span className="approval-actions"><b className={item.status}>{item.status === 'active' ? 'Activo' : 'Suspendido'}</b>{canManageBeneficiaries && <button disabled={busy} onClick={() => void setBeneficiaryStatus(item)}>{item.status === 'active' ? 'Suspender' : 'Activar'}</button>}</span></div>)}</article>
    <article className="module-list"><div className="card-head"><div><h2>Lotes de payouts</h2><p>Resultado por ítem y trazabilidad al movimiento del ledger</p></div><b>{batches.length}</b></div>{batches.length === 0 ? <div><span className="movement"><i>≡</i><b>Sin lotes<small>{canOperate ? 'Creá un borrador para comenzar' : 'No hay lotes para consultar'}</small></b></span><strong>Vacío</strong></div> : batches.map((batch) => <div className="payout-batch-row" key={batch.id}><span className="movement"><i>≡</i><b>{batch.externalReference}<small>{batch.description} · {batch.itemCount} ítems · {batch.sourceAccountReference} · {money(batch.totalAmount, batch.currency)}</small>{batch.items.map((item) => <small key={item.id}>{item.externalReference} · {item.beneficiaryName} · {money(item.amount, item.currency)} · {statusLabels[item.status] ?? item.status}{item.failureCode ? ` · ${item.failureCode}` : ''}</small>)}</b></span><span className="approval-actions"><b className={batch.status}>{statusLabels[batch.status] ?? batch.status}</b>{canOperate && batch.status === 'draft' && <button disabled={busy} onClick={() => void batchAction(batch, 'submit')}>Enviar</button>}{canOperate && ['draft', 'scheduled'].includes(batch.status) && <button className="cancel" disabled={busy} onClick={() => void batchAction(batch, 'cancel')}>Cancelar</button>}<button onClick={() => void downloadResult(batch)}>CSV ↓</button></span></div>)}</article>
    <p className="role-boundary-copy">Sandbox propio de Cimbra: el ledger y los estados son reales dentro del entorno, pero no se mueve dinero hasta conectar y homologar un riel directo por país. Los lotes inmediatos se despachan al aceptar; la recuperación de lotes programados en el Vercel gratuito actual es diaria y no ofrece todavía un SLO horario.</p>
  </div>;
}
