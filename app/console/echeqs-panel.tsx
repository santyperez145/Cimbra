'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; status: string };
type Echeq = {
  id: string; drawerAccountId: string; drawerAccountReference: string; drawerCustomerName: string;
  holderAccountId: string | null; holderAccountReference: string | null;
  amount: number; currency: string; description: string; externalReference: string;
  payload: string; toOrder: boolean; paymentDate: string; expiresAt: string; status: string;
  beneficiaryName: string; beneficiaryTaxLast4: string; endorsementCount: number; rejectReason: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  issued: 'Emitido', accepted: 'Aceptado', endorsed: 'Endosado', pending: 'En revisión',
  deposited: 'Depositado', cancelled: 'Anulado', returned: 'Devuelto', rejected: 'Rechazado', expired: 'Vencido',
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function money(value: number, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(value);
}

function todayAr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default function EcheqsPanel({ role, accounts }: { role: OrganizationRole; accounts: Account[] }) {
  const [echeqs, setEcheqs] = useState<Echeq[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const arsAccounts = accounts.filter((account) => account.currency === 'ARS' && account.status === 'active');
  const issuedCount = echeqs.filter((item) => item.status === 'issued').length;
  const acceptedCount = echeqs.filter((item) => item.status === 'accepted' || item.status === 'endorsed').length;
  const depositedCount = echeqs.filter((item) => item.status === 'deposited').length;
  const otherCount = echeqs.length - issuedCount - acceptedCount - depositedCount;

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/echeqs?limit=50', { cache: 'no-store' });
    const result = await response.json() as { data?: Echeq[] };
    if (!response.ok) throw new Error(apiError(result, 'No pudimos cargar los ECHEQ.'));
    setEcheqs(result.data ?? []);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load().catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/echeqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        drawerAccountId: data.get('drawerAccountId'), externalReference: data.get('externalReference'),
        description: data.get('description'), amount: data.get('amount'), currency: 'ARS',
        beneficiaryName: data.get('beneficiaryName'), beneficiaryTaxId: data.get('beneficiaryTaxId'),
        paymentDate: data.get('paymentDate') || todayAr(), toOrder: data.get('toOrder') === 'on',
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos emitir el ECHEQ.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/echeqs/${encodeURIComponent(String(data.get('echeqId')))}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ accountId: data.get('accountId'), taxId: data.get('taxId') }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos aceptar el ECHEQ.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function deposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/echeqs/${encodeURIComponent(String(data.get('echeqId')))}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ accountId: data.get('accountId'), taxId: data.get('taxId') }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos depositar el ECHEQ.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function endorse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/echeqs/${encodeURIComponent(String(data.get('echeqId')))}/endorse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ beneficiaryName: data.get('beneficiaryName'), beneficiaryTaxId: data.get('beneficiaryTaxId') }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos endosar el ECHEQ.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function mutate(path: string, fallback: string) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(path, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, fallback)); return; }
    await load().catch((error: Error) => setFeedback(error.message));
  }

  return <div className="module-view wallets-console collections-console">
    <div className="module-view-head"><div><p>ARGENTINA · ECHEQ</p><h1>Cheques electrónicos sandbox</h1><span>Emisión, aceptación, endoso y depósito entre cuentas ARS del tenant. No es Coelsa ni cámara de compensación.</span></div><span className="module-health"><i /> {issuedCount} emitidos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><span>Emitidos</span><strong>{issuedCount}</strong></article>
      <article><span>En circulación</span><strong>{acceptedCount}</strong></article>
      <article><span>Depositados</span><strong>{depositedCount}</strong></article>
      <article><span>Otros</span><strong>{otherCount}</strong></article>
    </div>
    <p className="role-boundary-copy">El payload cimbra:echeq:v1 no es un CMC7 ni un ID Coelsa. Descuento, custodia, USD y depósito en CBU/CVU responden 422. La acreditación sandbox es inmediata sobre el ledger, no a 48 horas de cámara.</p>

    {canOperate && <div className="compliance-grid wallets-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Emitir ECHEQ</h2><p>Cuenta libradora ARS · CUIT del beneficiario</p></div></div>
        <form className="book-statement-body" onSubmit={issue}>
          <label>Librador<select name="drawerAccountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} placeholder="CHQ-001" /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
          <label>Beneficiario<input name="beneficiaryName" required minLength={2} maxLength={120} /></label>
          <label>CUIT<input name="beneficiaryTaxId" required minLength={11} maxLength={13} placeholder="30-00007567-8" /></label>
          <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Fecha de pago<input name="paymentDate" type="date" defaultValue={todayAr()} /></label>
          <fieldset>
            <legend>Circulación</legend>
            <label><input type="checkbox" name="toOrder" defaultChecked /> A la orden (permite endoso)</label>
          </fieldset>
          <button className="app-primary" disabled={busy || arsAccounts.length < 2}>{busy ? 'Emitiendo…' : 'Emitir'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Aceptar</h2><p>CUIT del tenedor actual</p></div></div>
        <form className="book-statement-body" onSubmit={accept}>
          <label>ECHEQ<select name="echeqId" required defaultValue=""><option value="" disabled>Seleccionar</option>{echeqs.filter((item) => item.status === 'issued' || item.status === 'endorsed').map((item) => <option key={item.id} value={item.id}>{item.externalReference} · {item.beneficiaryName}</option>)}</select></label>
          <label>Cuenta tenedora<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>CUIT<input name="taxId" required minLength={11} maxLength={13} /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Aceptando…' : 'Aceptar'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Depositar</h2><p>Sólo cuenta Cimbra del tenedor</p></div></div>
        <form className="book-statement-body" onSubmit={deposit}>
          <label>ECHEQ<select name="echeqId" required defaultValue=""><option value="" disabled>Seleccionar</option>{echeqs.filter((item) => item.status === 'accepted').map((item) => <option key={item.id} value={item.id}>{item.externalReference} · {money(item.amount)}</option>)}</select></label>
          <label>Cuenta depositaria<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>CUIT<input name="taxId" required minLength={11} maxLength={13} /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Depositando…' : 'Depositar'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Endosar</h2><p>Sólo ECHEQ a la orden ya aceptado</p></div></div>
        <form className="book-statement-body" onSubmit={endorse}>
          <label>ECHEQ<select name="echeqId" required defaultValue=""><option value="" disabled>Seleccionar</option>{echeqs.filter((item) => item.status === 'accepted' && item.toOrder).map((item) => <option key={item.id} value={item.id}>{item.externalReference} · {item.beneficiaryName}</option>)}</select></label>
          <label>Nuevo beneficiario<input name="beneficiaryName" required minLength={2} maxLength={120} /></label>
          <label>CUIT<input name="beneficiaryTaxId" required minLength={11} maxLength={13} /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Endosando…' : 'Endosar'}</button>
        </form>
      </article>
    </div>}

    <article className="module-list">
      <div className="card-head"><div><h2>ECHEQ del tenant</h2><p>Payload cimbra:echeq:v1 · riel cimbra_sandbox</p></div></div>
      {echeqs.length === 0 && <div className="table-empty">Todavía no hay ECHEQ en este tenant.</div>}
      {echeqs.map((item) => <div key={item.id}>
        <div className="movement">
          <strong>{item.externalReference}</strong>
          <span>{item.drawerAccountReference} → {item.beneficiaryName} · CUIT ****{item.beneficiaryTaxLast4}</span>
          <small>{item.payload} · pago {item.paymentDate}{item.toOrder ? ' · a la orden' : ' · no a la orden'}{item.endorsementCount ? ` · ${item.endorsementCount} endoso(s)` : ''}{item.holderAccountReference ? ` · tenedor ${item.holderAccountReference}` : ''}{item.rejectReason ? ` · ${item.rejectReason}` : ''}</small>
        </div>
        <strong>{money(item.amount, item.currency)}</strong>
        <span>{STATUS_LABELS[item.status] ?? item.status}</span>
        {canOperate && item.status === 'issued' && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/echeqs/${item.id}/cancel`, 'No pudimos anular el ECHEQ.')}>Anular</button>}
        {canOperate && (item.status === 'accepted' || item.status === 'endorsed') && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/echeqs/${item.id}/return`, 'No pudimos devolver el ECHEQ.')}>Devolver</button>}
      </div>)}
    </article>
  </div>;
}
