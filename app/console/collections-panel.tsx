'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; status: string };
type PaymentLink = {
  id: string; accountId: string; accountReference: string; customerName: string;
  amount: number; collectedAmount: number;   remainingAmount: number; refundedAmount: number; partiallyCollected: boolean; partiallyRefunded: boolean; currency: string; description: string; externalReference: string;
  allowedMethods: string[]; payload: string; qrDebtId: string | null; collectionTillId: string | null;
  qrPayload: string | null; cvu: string | null; checkoutUrl: string; status: string; expiresAt: string;
  paidMethod: string | null; payerAccountReference: string | null; createdAt: string;
  items: Array<{ description: string; amount: number; quantity: number }>;
  credits: Array<{ id: string; amount: number; method: string; createdAt: string }>;
  refunds: Array<{ id: string; amount: number; createdAt: string }>;
};
type CollectionTill = {
  id: string; accountId: string; accountReference: string; customerName: string;
  name: string; externalReference: string; cvu: string; alias: string | null;
  paymentQrId: string | null; status: string; createdAt: string;
};
type PaymentQr = { id: string; accountId: string; kind: string; status: string; description: string };
type QrDebt = { id: string; accountId: string; status: string; description: string; externalReference: string; amount: number };

const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto', pending: 'En revisión', paid: 'Cobrado', expired: 'Expirado', cancelled: 'Cancelado', refunded: 'Devuelto',
  active: 'Activo', disabled: 'Deshabilitado',
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
  const [tills, setTills] = useState<CollectionTill[]>([]);
  const [staticQrs, setStaticQrs] = useState<PaymentQr[]>([]);
  const [openDebts, setOpenDebts] = useState<QrDebt[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const arsAccounts = accounts.filter((account) => account.currency === 'ARS' && account.status === 'active');
  const openCount = links.filter((link) => link.status === 'open').length;
  const paidCount = links.filter((link) => link.status === 'paid').length;
  const refundedCount = links.filter((link) => link.status === 'refunded').length;
  const pendingCount = links.filter((link) => link.status === 'pending' || link.status === 'expired' || link.status === 'cancelled').length;
  const activeTills = tills.filter((till) => till.status === 'active').length;

  const load = useCallback(async () => {
    const [linksResponse, tillsResponse, qrResponse, debtResponse] = await Promise.all([
      authenticatedFetch('/api/v1/payment-links?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/collection-tills?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/payment-qrs?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/qr-debts?limit=50', { cache: 'no-store' }),
    ]);
    const linksResult = await linksResponse.json() as { data?: PaymentLink[]; error?: unknown };
    if (!linksResponse.ok) throw new Error(apiError(linksResult, 'No pudimos cargar los links de cobro.'));
    const tillsResult = await tillsResponse.json() as { data?: CollectionTill[]; error?: unknown };
    if (!tillsResponse.ok) throw new Error(apiError(tillsResult, 'No pudimos cargar los puntos de recaudación.'));
    setLinks(linksResult.data ?? []);
    setTills(tillsResult.data ?? []);
    if (qrResponse.ok) {
      const qrResult = await qrResponse.json() as { data?: PaymentQr[] };
      setStaticQrs((qrResult.data ?? []).filter((qr) => qr.kind === 'static' && qr.status === 'active'));
    }
    if (debtResponse.ok) {
      const debtResult = await debtResponse.json() as { data?: QrDebt[] };
      setOpenDebts((debtResult.data ?? []).filter((debt) => debt.status === 'open'));
    }
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
    const methods = ['internal', 'sandbox_inbound', 'cimbra_qr', 'cimbra_cvu'].filter((method) => data.get(method) === 'on');
    const qrDebtId = String(data.get('qrDebtId') ?? '');
    const collectionTillId = String(data.get('collectionTillId') ?? '');
    const itemDescription = String(data.get('itemDescription') ?? '').trim();
    const itemAmount = String(data.get('itemAmount') ?? '').trim();
    const items = itemDescription && itemAmount
      ? [{ description: itemDescription, amount: itemAmount, quantity: Number(data.get('itemQuantity') || 1) }]
      : undefined;
    const response = await authenticatedFetch('/api/v1/payment-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: data.get('accountId'), externalReference: data.get('externalReference'),
        description: data.get('description'), amount: data.get('amount'), currency: 'ARS',
        expiresInMinutes: Number(data.get('expiresInMinutes') || 60), methods,
        qrDebtId: qrDebtId || undefined, collectionTillId: collectionTillId || undefined, items,
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
    const amount = String(data.get('amount') ?? '').trim();
    const response = await authenticatedFetch(`/api/v1/payment-links/${encodeURIComponent(linkId)}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        method, payerAccountId: method === 'sandbox_inbound' ? undefined : data.get('payerAccountId') || undefined,
        amount: method === 'cimbra_cvu' && amount ? amount : undefined,
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos cobrar el link.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function refund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const linkId = String(data.get('linkId') ?? '');
    const amount = String(data.get('amount') ?? '').trim();
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/payment-links/${encodeURIComponent(linkId)}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(amount ? { amount } : {}),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos devolver el cobro.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function createTill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const paymentQrId = String(data.get('paymentQrId') ?? '');
    const alias = String(data.get('alias') ?? '').trim();
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/collection-tills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: data.get('accountId'), externalReference: data.get('externalReference'),
        name: data.get('name'), paymentQrId: paymentQrId || undefined, alias: alias || undefined,
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos crear el punto de recaudación.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function creditTill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const tillId = String(data.get('tillId') ?? '');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/collection-tills/${encodeURIComponent(tillId)}/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        externalReference: data.get('externalReference'), description: data.get('description'),
        amount: data.get('amount'), currency: 'ARS',
      }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos acreditar el punto de recaudación.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function assignTillAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const tillId = String(data.get('tillId') ?? '');
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/collection-tills/${encodeURIComponent(tillId)}/alias`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ alias: data.get('alias') }),
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos asignar el alias.')); return; }
    form.reset();
    await load().catch((error: Error) => setFeedback(error.message));
  }

  async function mutate(path: string, fallback: string, method = 'POST') {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(path, {
      method, headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as { error?: unknown };
    setBusy(false);
    if (!response.ok) { setFeedback(apiError(result, fallback)); return; }
    await load().catch((error: Error) => setFeedback(error.message));
  }

  return <div className="module-view wallets-console collections-console">
    <div className="module-view-head"><div><p>ARGENTINA · COBRANZAS</p><h1>Cobranzas</h1><span>Links de cobro, deuda QR o till asociado, y puntos de recaudación con CVU propio. No es caja BIND, POS ni botón de tarjeta.</span></div><span className="module-health"><i /> {openCount} abiertos · {activeTills} puntos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><span>Abiertos</span><strong>{openCount}</strong></article>
      <article><span>Cobrados</span><strong>{paidCount}</strong></article>
      <article><span>Devueltos</span><strong>{refundedCount}</strong></article>
      <article><span>Puntos activos</span><strong>{activeTills}</strong></article>
    </div>
    <p className="role-boundary-copy">El link sandbox se paga con una cuenta Cimbra, un inbound ledger, el QR de una deuda asociada o el CVU de un till. Sólo el medio cimbra_cvu admite parciales, varios créditos o un importe mayor al restante. La devolución puede ser total o parcial; un link CVU puede volver a cobrar si queda restante. Un inbound suelto al till no cierra el link. No procesa tarjetas, POS, Tap to Phone, checkout PCI ni QR interoperable.</p>
    {pendingCount > 0 && <p className="role-boundary-copy">{pendingCount} links en revisión, expirados o cancelados.</p>}

    {canOperate && <div className="compliance-grid wallets-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Crear link de cobro</h2><p>Cuenta ARS argentina · checkout /pay</p></div></div>
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
            <label><input type="checkbox" name="cimbra_qr" /> QR de deuda asociada</label>
            <label><input type="checkbox" name="cimbra_cvu" /> CVU del punto de recaudación</label>
          </fieldset>
          <label>Deuda QR opcional<select name="qrDebtId" defaultValue=""><option value="">Sin asociar</option>{openDebts.map((debt) => <option key={debt.id} value={debt.id}>{debt.externalReference} · {money(debt.amount)}</option>)}</select></label>
          <label>Punto opcional<select name="collectionTillId" defaultValue=""><option value="">Sin asociar</option>{tills.filter((till) => till.status === 'active').map((till) => <option key={till.id} value={till.id}>{till.name} · {till.cvu.slice(-4)}</option>)}</select></label>
          <label>Ítem de detalle (opcional, no cambia el monto)<input name="itemDescription" minLength={2} maxLength={180} placeholder="Factura N° 456" /></label>
          <label>Monto del ítem<input name="itemAmount" type="number" min="0.01" step="0.01" /></label>
          <label>Cantidad<input name="itemQuantity" type="number" min={1} max={9999} defaultValue={1} /></label>
          <button className="app-primary" disabled={busy || arsAccounts.length === 0}>{busy ? 'Creando…' : 'Crear link'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Cobrar un link</h2><p>Internal exige pagador distinto</p></div></div>
        <form className="book-statement-body" onSubmit={pay}>
          <label>Link<select name="linkId" required defaultValue=""><option value="" disabled>Seleccionar</option>{links.filter((link) => link.status === 'open').map((link) => <option key={link.id} value={link.id}>{link.externalReference} · resta {money(link.remainingAmount ?? link.amount)}</option>)}</select></label>
          <label>Método<select name="method" defaultValue="internal"><option value="internal">Cuenta Cimbra</option><option value="sandbox_inbound">Inbound sandbox</option><option value="cimbra_qr">QR de deuda</option><option value="cimbra_cvu">CVU del till</option></select></label>
          <label>Pagador<select name="payerAccountId" defaultValue=""><option value="">Inbound o CVU sin pagador</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Monto CVU opcional<input name="amount" type="number" min="0.01" step="0.01" placeholder="Vacío = restante" /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Cobrando…' : 'Cobrar'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Devolver un cobro</h2><p>Vacío = restante cobrado</p></div></div>
        <form className="book-statement-body" onSubmit={refund}>
          <label>Link<select name="linkId" required defaultValue=""><option value="" disabled>Seleccionar</option>{links.filter((link) => link.status === 'paid' || (link.status === 'open' && (link.collectedAmount ?? 0) > 0)).map((link) => <option key={link.id} value={link.id}>{link.externalReference} · cobrado {money(link.collectedAmount ?? 0)}</option>)}</select></label>
          <label>Monto opcional<input name="amount" type="number" min="0.01" step="0.01" placeholder="Vacío = todo lo cobrado" /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Devolviendo…' : 'Devolver'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Crear punto de recaudación</h2><p>CVU sandbox propio · no es caja BIND</p></div></div>
        <form className="book-statement-body" onSubmit={createTill}>
          <label>Cuenta cobradora<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Nombre<input name="name" required minLength={2} maxLength={80} placeholder="Mostrador Sur" /></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} placeholder="TILL-001" /></label>
          <label>Alias opcional<input name="alias" minLength={6} maxLength={20} placeholder="COMERCIO.SUR" /></label>
          <label>QR estático opcional<select name="paymentQrId" defaultValue=""><option value="">Sin asociar</option>{staticQrs.map((qr) => <option key={qr.id} value={qr.id}>{qr.description}</option>)}</select></label>
          <button className="app-primary" disabled={busy || arsAccounts.length === 0}>{busy ? 'Creando…' : 'Crear punto'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Acreditar un punto</h2><p>Inbound ledger al CVU del till</p></div></div>
        <form className="book-statement-body" onSubmit={creditTill}>
          <label>Punto<select name="tillId" required defaultValue=""><option value="" disabled>Seleccionar</option>{tills.filter((till) => till.status === 'active').map((till) => <option key={till.id} value={till.id}>{till.name} · {till.cvu.slice(-4)}</option>)}</select></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} placeholder="INB-001" /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
          <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Acreditando…' : 'Acreditar'}</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Alias del punto</h2><p>Un cambio real cada 24 h</p></div></div>
        <form className="book-statement-body" onSubmit={assignTillAlias}>
          <label>Punto<select name="tillId" required defaultValue=""><option value="" disabled>Seleccionar</option>{tills.filter((till) => till.status === 'active').map((till) => <option key={till.id} value={till.id}>{till.name}</option>)}</select></label>
          <label>Alias<input name="alias" required minLength={6} maxLength={20} placeholder="COMERCIO.SUR" /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Asignando…' : 'Asignar alias'}</button>
        </form>
      </article>
    </div>}

    <article className="module-list">
      <div className="card-head"><div><h2>Puntos de recaudación</h2><p>CVU sandbox por till · no viaja por Coelsa</p></div></div>
      {tills.length === 0 && <div className="table-empty">Todavía no hay puntos de recaudación en este tenant.</div>}
      {tills.map((till) => <div key={till.id}>
        <div className="movement">
          <strong>{till.name}</strong>
          <span>{till.accountReference} · {till.customerName}</span>
          <small>{till.cvu}{till.alias ? ` · ${till.alias}` : ''} · {till.externalReference}</small>
        </div>
        <strong>{till.cvu.slice(-4)}</strong>
        <span>{STATUS_LABELS[till.status] ?? till.status}</span>
        {canOperate && till.status === 'active' && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/collection-tills/${till.id}`, 'No pudimos deshabilitar el punto.', 'DELETE')}>Deshabilitar</button>}
      </div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>Links de cobro</h2><p>Payload cimbra:link:v1 · no es un checkout de red</p></div></div>
      {links.length === 0 && <div className="table-empty">Todavía no hay links de cobro en este tenant.</div>}
      {links.map((link) => <div key={link.id}>
        <div className="movement">
          <strong>{link.externalReference}</strong>
          <span>{link.accountReference} · {link.customerName}</span>
          <small>{link.payload} · {link.allowedMethods.join(' · ')}{link.qrPayload ? ` · ${link.qrPayload}` : ''}{link.cvu ? ` · ${link.cvu}` : ''}{link.checkoutUrl ? ` · ${link.checkoutUrl}` : ''}{(link.items?.length ?? 0) > 0 ? ` · ${link.items.length} ítems` : ''}{(link.credits?.length ?? 0) > 0 ? ` · ${link.credits.length} créditos` : ''}{(link.refunds?.length ?? 0) > 0 ? ` · ${link.refunds.length} devoluciones` : ''}{link.partiallyCollected ? ' · cobro parcial' : ''}{link.partiallyRefunded ? ' · devolución parcial' : ''}{link.paidMethod ? ` · cobrado ${link.paidMethod}` : ''}{link.payerAccountReference ? ` · pagador ${link.payerAccountReference}` : ''}</small>
        </div>
        <strong>{money(link.collectedAmount ?? 0, link.currency)} / {money(link.amount, link.currency)}</strong>
        <span>{STATUS_LABELS[link.status] ?? link.status}</span>
        {canOperate && link.status === 'open' && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/payment-links/${link.id}/cancel`, 'No pudimos cancelar el link.')}>Cancelar</button>}
        {canOperate && (link.status === 'paid' || (link.status === 'open' && (link.collectedAmount ?? 0) > 0)) && <button type="button" className="danger-link" disabled={busy} onClick={() => void mutate(`/api/v1/payment-links/${link.id}/refund`, 'No pudimos devolver el cobro.')}>Devolver restante</button>}
      </div>)}
    </article>
  </div>;
}
