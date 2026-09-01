'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; status: string };
type PaymentLink = {
  id: string; accountId: string; accountReference: string; customerName: string;
  amount: number; currency: string; description: string; externalReference: string;
  allowedMethods: string[]; payload: string; status: string; expiresAt: string;
  paidMethod: string | null; payerAccountReference: string | null; createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto', pending: 'En revisión', paid: 'Cobrado', expired: 'Expirado', cancelled: 'Cancelado', refunded: 'Devuelto',
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

export default function CollectionsPanel({ role, accounts }: { role: OrganizationRole; accounts: Account[] }) {
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const arsAccounts = accounts.filter((account) => account.currency === 'ARS' && account.status === 'active');
  const openCount = links.filter((link) => link.status === 'open').length;
  const paidCount = links.filter((link) => link.status === 'paid').length;
  const refundedCount = links.filter((link) => link.status === 'refunded').length;
  const pendingCount = links.filter((link) => link.status === 'pending' || link.status === 'expired' || link.status === 'cancelled').length;

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/payment-links?limit=50', { cache: 'no-store' });
    const result = await response.json() as { data?: PaymentLink[] };
    if (!response.ok) throw new Error(apiError(result, 'No pudimos cargar los links de cobro.'));
    setLinks(result.data ?? []);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load().catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setFeedback('');
    const methods = ['internal', 'sandbox_inbound'].filter((method) => data.get(method) === 'on');
    const response = await authenticatedFetch('/api/v1/payment-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: data.get('accountId'), externalReference: data.get('externalReference'),
        description: data.get('description'), amount: data.get('amount'), currency: 'ARS',
        expiresInMinutes: Number(data.get('expiresInMinutes') || 60), methods,
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos crear el link.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const linkId = String(data.get('linkId') ?? '');
    const method = String(data.get('method') ?? 'internal');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/payment-links/${encodeURIComponent(linkId)}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        method, payerAccountId: method === 'internal' ? data.get('payerAccountId') : undefined,
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos cobrar el link.')); return; }
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
    <div className="module-view-head"><div><p>ARGENTINA · COBRANZAS</p><h1>Links de cobro</h1><span>Cobro sandbox contra cuentas ARS argentinas. No es botón de pago de red, POS ni QR interoperable.</span></div><span className="module-health"><i /> {openCount} abiertos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><span>Abiertos</span><strong>{openCount}</strong></article>
      <article><span>Cobrados</span><strong>{paidCount}</strong></article>
      <article><span>Devueltos</span><strong>{refundedCount}</strong></article>
      <article><span>Otros</span><strong>{pendingCount}</strong></article>
    </div>
    <p className="role-boundary-copy">El link de cobro sandbox se paga con una cuenta Cimbra del tenant o con un inbound ledger. No procesa tarjetas, POS, Tap to Phone ni QR interoperable.</p>

    {canOperate && <div className="compliance-grid wallets-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Crear link de cobro</h2><p>Cuenta ARS argentina · monto cerrado</p></div></div>
        <form className="book-statement-body" onSubmit={create}>
          <label>Comercio<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} placeholder="FAC-001" /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
          <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Vence (minutos)<input name="expiresInMinutes" type="number" min={5} max={10080} defaultValue={60} /></label>
          <fieldset>
            <legend>Medios sandbox</legend>
            <label><input type="checkbox" name="internal" defaultChecked /> Cuenta Cimbra (eco cerrado)</label>
            <label><input type="checkbox" name="sandbox_inbound" defaultChecked /> Inbound sandbox</label>
          </fieldset>
          <button className="app-primary" disabled={busy || arsAccounts.length === 0}>{busy ? 'Creando…' : 'Crear link'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Cobrar un link</h2><p>Internal exige pagador distinto</p></div></div>
        <form className="book-statement-body" onSubmit={pay}>
          <label>Link<select name="linkId" required defaultValue=""><option value="" disabled>Seleccionar</option>{links.filter((link) => link.status === 'open').map((link) => <option key={link.id} value={link.id}>{link.externalReference} · {money(link.amount)}</option>)}</select></label>
          <label>Método<select name="method" defaultValue="internal"><option value="internal">Cuenta Cimbra</option><option value="sandbox_inbound">Inbound sandbox</option></select></label>
          <label>Pagador<select name="payerAccountId" defaultValue=""><option value="">Sólo para cobro interno</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Cobrando…' : 'Cobrar'}</button>
        </form>
      </article>
    </div>}

    <article className="module-list">
      <div className="card-head"><div><h2>Links de cobro</h2><p>Payload cimbra:link:v1 · no es un checkout de red</p></div></div>
      {links.length === 0 && <div className="table-empty">Todavía no hay links de cobro en este tenant.</div>}
      {links.map((link) => <div key={link.id}>
        <div className="movement">
          <strong>{link.externalReference}</strong>
          <span>{link.accountReference} · {link.customerName}</span>
          <small>{link.payload} · {link.allowedMethods.join(' · ')}{link.paidMethod ? ` · cobrado ${link.paidMethod}` : ''}{link.payerAccountReference ? ` · pagador ${link.payerAccountReference}` : ''}</small>
        </div>
        <strong>{money(link.amount, link.currency)}</strong>
        <span>{STATUS_LABELS[link.status] ?? link.status}</span>
        {canOperate && link.status === 'open' && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/payment-links/${link.id}/cancel`, 'No pudimos cancelar el link.')}>Cancelar</button>}
        {canOperate && link.status === 'paid' && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/payment-links/${link.id}/refund`, 'No pudimos devolver el cobro.')}>Devolver</button>}
      </div>)}
    </article>
  </div>;
}
