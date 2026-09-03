'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; status: string; balance?: number };
type Instrument = {
  id: string; accountId: string; accountReference: string; customerName: string; kind: 'cvu' | 'alias';
  value: string; last4: string; holderName: string; taxIdLast4: string; status: string; createdAt: string;
};
type Transfer = {
  id: string; scheme: string; direction: string; sourceAccountReference: string | null;
  destinationAccountReference: string | null; counterpartyKind: string; counterpartyLast4: string;
  counterpartyHolderName: string | null; amount: number; currency: string; description: string;
  status: string; rail: string; createdAt: string;
};
type PaymentQr = {
  id: string; accountReference: string; amount: number | null; currency: string; description: string;
  payload: string; kind: 'dynamic' | 'static' | 'debt'; status: string; expiresAt: string | null; createdAt: string;
};
type QrSaleOrder = {
  id: string; paymentQrId: string; qrPayload: string; accountReference: string; amount: number;
  description: string; externalReference: string; status: string; expiresAt: string;
};
type QrDebt = {
  id: string; paymentQrId: string; payload: string; accountReference: string; amount: number;
  description: string; externalReference: string; status: string; expiresAt: string;
};
type DirectoryPreview = {
  found: boolean; kind: string; last4: string; holderName: string | null; taxIdLast4: string | null; rail: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', settled: 'Liquidada',
  returned: 'Devuelta', expired: 'Expirada', cancelled: 'Cancelada', active: 'Activo', paid: 'Pagado',
  revoked: 'Eliminado', superseded: 'Reemplazada', open: 'Abierta',
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function qrKindLabel(kind: PaymentQr['kind']) {
  if (kind === 'static') return 'Estático';
  if (kind === 'debt') return 'Deuda';
  return 'Dinámico';
}

function money(value: number, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(value);
}

export default function InstantPaymentsPanel({ role, accounts }: { role: OrganizationRole; accounts: Account[] }) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [debits, setDebits] = useState<Transfer[]>([]);
  const [qrs, setQrs] = useState<PaymentQr[]>([]);
  const [saleOrders, setSaleOrders] = useState<QrSaleOrder[]>([]);
  const [debts, setDebts] = useState<QrDebt[]>([]);
  const [preview, setPreview] = useState<DirectoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [qrKind, setQrKind] = useState<'dynamic' | 'static'>('dynamic');
  const canOperate = roleCan(role, 'finance.write');
  const arsAccounts = accounts.filter((account) => account.currency === 'ARS' && account.status === 'active');

  const load = useCallback(async () => {
    const [instrumentResponse, transferResponse, debitResponse, qrResponse, saleOrderResponse, debtResponse] = await Promise.all([
      authenticatedFetch('/api/v1/rail-instruments?limit=100', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/instant-transfers?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/debit-requests?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/payment-qrs?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/qr-sale-orders?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/qr-debts?limit=50', { cache: 'no-store' }),
    ]);
    const instrumentResult = await instrumentResponse.json() as { data?: Instrument[] };
    const transferResult = await transferResponse.json() as { data?: Transfer[] };
    const debitResult = await debitResponse.json() as { data?: Transfer[] };
    const qrResult = await qrResponse.json() as { data?: PaymentQr[] };
    const saleOrderResult = await saleOrderResponse.json() as { data?: QrSaleOrder[] };
    const debtResult = await debtResponse.json() as { data?: QrDebt[] };
    if (!instrumentResponse.ok) throw new Error(apiError(instrumentResult, 'No pudimos cargar los instrumentos.'));
    if (!transferResponse.ok) throw new Error(apiError(transferResult, 'No pudimos cargar las transferencias.'));
    if (!debitResponse.ok) throw new Error(apiError(debitResult, 'No pudimos cargar las solicitudes de débito.'));
    if (!qrResponse.ok) throw new Error(apiError(qrResult, 'No pudimos cargar los QR.'));
    if (!saleOrderResponse.ok) throw new Error(apiError(saleOrderResult, 'No pudimos cargar las órdenes de venta.'));
    if (!debtResponse.ok) throw new Error(apiError(debtResult, 'No pudimos cargar las deudas QR.'));
    setInstruments(instrumentResult.data ?? []);
    setTransfers(transferResult.data ?? []);
    setDebits(debitResult.data ?? []);
    setQrs(qrResult.data ?? []);
    setSaleOrders(saleOrderResult.data ?? []);
    setDebts(debtResult.data ?? []);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load().catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const alias = String(form.get('alias') ?? '').trim();
    const response = await authenticatedFetch('/api/v1/rail-instruments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ accountId: form.get('accountId'), alias: alias || null }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok
      ? 'CVU sandbox emitido. Prefijo 0009999 de Cimbra; no es un código Coelsa ni un CBU bancario.'
      : apiError(result, 'No pudimos emitir el instrumento.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function assignAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const instrumentId = String(form.get('instrumentId') ?? '');
    const response = await authenticatedFetch(`/api/v1/rail-instruments/${instrumentId}/alias`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ alias: String(form.get('alias') ?? '').trim() }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok
      ? 'Alias asignado en este tenant. No es un alias Coelsa; un cambio real queda bloqueado 24 horas.'
      : apiError(result, 'No pudimos asignar el alias.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function revokeCvu(id: string) {
    if (!window.confirm('Eliminar el CVU no borra la cuenta ni el saldo. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/rail-instruments/${id}`, {
      method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok
      ? 'CVU sandbox eliminado. La cuenta ARS y el saldo siguen; se puede volver a emitir el mismo CVU.'
      : apiError(result, 'No pudimos eliminar el CVU.'));
    if (response.ok) await load();
    setBusy(false);
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setFeedback(''); setPreview(null);
    const response = await authenticatedFetch(`/api/v1/rail-directory?q=${encodeURIComponent(String(form.get('q') ?? ''))}`, { cache: 'no-store' });
    const result = await response.json() as DirectoryPreview & { error?: unknown };
    if (!response.ok) { setFeedback(apiError(result, 'No pudimos consultar el directorio sandbox.')); setBusy(false); return; }
    setPreview(result);
    setBusy(false);
  }

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/instant-transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        externalReference: form.get('externalReference'), accountId: form.get('accountId'), destination: form.get('destination'),
        description: form.get('description'), amount: form.get('amount'), currency: 'ARS', direction: form.get('direction'),
        confirmHolder: true, holderName: form.get('holderName'), taxIdLast4: form.get('taxIdLast4'),
      }),
    });
    const result = await response.json() as { requiresApproval?: boolean; error?: unknown };
    setFeedback(response.ok
      ? (result.requiresApproval
        ? 'Solicitud enviada a Aprobaciones (maker/checker).'
        : 'Transferencia instantánea registrada en el riel sandbox de Cimbra.')
      : apiError(result, 'No pudimos crear la transferencia.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function requestDebit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/debit-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        externalReference: form.get('externalReference'), collectorAccountId: form.get('collectorAccountId'),
        payerDestination: form.get('payerDestination'), description: form.get('description'), amount: form.get('amount'), currency: 'ARS',
      }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Solicitud de débito interna creada. No es DEBIN contra un banco.' : apiError(result, 'No pudimos crear la solicitud.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function respond(id: string, decision: 'accept' | 'reject') {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/debit-requests/${id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json() as { requiresApproval?: boolean; error?: unknown };
    setFeedback(response.ok
      ? (result.requiresApproval
        ? 'Aceptación enviada a Aprobaciones (maker/checker).'
        : `Solicitud ${decision === 'accept' ? 'aceptada' : 'rechazada'}.`)
      : apiError(result, 'No pudimos resolver la solicitud.'));
    if (response.ok) await load();
    setBusy(false);
  }

  async function createQr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const amount = String(form.get('amount') ?? '').trim();
    const kind = String(form.get('kind') ?? 'dynamic') === 'static' ? 'static' : 'dynamic';
    const response = await authenticatedFetch('/api/v1/payment-qrs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: form.get('accountId'), description: form.get('description'), kind, currency: 'ARS',
        amount: kind === 'dynamic' && amount ? amount : undefined,
      }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok
      ? (kind === 'static' ? 'QR estático Cimbra creado. Reutilizable, sin vencimiento. No es EMVCo ni Transferencias 3.0.' : 'QR Cimbra creado. No es el QR interoperable argentino.')
      : apiError(result, 'No pudimos crear el QR.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function payQr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const qrId = String(form.get('qrId') ?? '');
    const amount = String(form.get('amount') ?? '').trim();
    const response = await authenticatedFetch(`/api/v1/payment-qrs/${qrId}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ sourceAccountId: form.get('sourceAccountId'), externalReference: form.get('externalReference'), amount: amount || undefined }),
    });
    const result = await response.json() as { requiresApproval?: boolean; error?: unknown };
    setFeedback(response.ok
      ? (result.requiresApproval
        ? 'Pago QR enviado a Aprobaciones (maker/checker).'
        : 'QR cobrado entre cuentas del tenant.')
      : apiError(result, 'No pudimos cobrar el QR.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function cancelQr(id: string) {
    if (!window.confirm('El QR dejará de cobrar. Los pagos ya liquidados no se revierten. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/payment-qrs/${id}/cancel`, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'QR cancelado.' : apiError(result, 'No pudimos cancelar el QR.'));
    if (response.ok) await load();
    setBusy(false);
  }

  async function createSaleOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/qr-sale-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        paymentQrId: form.get('paymentQrId'), externalReference: form.get('externalReference'),
        description: form.get('description'), amount: form.get('amount'), currency: 'ARS',
      }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Orden de venta Cimbra creada. El QR estático cobra ese monto hasta que expire, se pague o se elimine.' : apiError(result, 'No pudimos crear la orden de venta.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function cancelSaleOrder(id: string) {
    if (!window.confirm('El QR estático vuelve a monto abierto. Los pagos ya liquidados no se revierten. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/qr-sale-orders/${id}`, {
      method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Orden de venta eliminada.' : apiError(result, 'No pudimos eliminar la orden de venta.'));
    if (response.ok) await load();
    setBusy(false);
  }

  async function createDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/qr-debts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: form.get('accountId'), externalReference: form.get('externalReference'),
        description: form.get('description'), amount: form.get('amount'), currency: 'ARS',
      }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Deuda QR Cimbra creada. Un pago, monto cerrado. No es deuda BIND ni PCT Coelsa.' : apiError(result, 'No pudimos crear la deuda QR.'));
    if (response.ok) { formElement.reset(); await load(); }
    setBusy(false);
  }

  async function cancelDebt(id: string) {
    if (!window.confirm('La deuda y su QR dejarán de cobrarse. Los pagos ya liquidados no se revierten. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/qr-debts/${id}`, {
      method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Deuda QR eliminada.' : apiError(result, 'No pudimos eliminar la deuda QR.'));
    if (response.ok) await load();
    setBusy(false);
  }

  async function returnTransfer(id: string) {
    if (!window.confirm('La devolución crea postings compensatorios. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/instant-transfers/${id}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    });
    const result = await response.json() as {
      requiresApproval?: boolean; approval?: { id: string }; error?: unknown;
    };
    if (!response.ok) setFeedback(apiError(result, 'No pudimos devolver la transferencia.'));
    else if (result.requiresApproval) setFeedback('Devolución enviada a Aprobaciones (maker/checker).');
    else setFeedback('Devolución compensatoria registrada.');
    if (response.ok) await load();
    setBusy(false);
  }

  return <div className="module-view wallets-console instant-console">
    <div className="module-view-head"><div><p>ARGENTINA · PAGOS INSTANTÁNEOS</p><h1>CVU, alias, débito y QR</h1><span>Riel sandbox de Cimbra con confirmación de titular. No es Transferencias 3.0, DEBIN ni QR interoperable de Coelsa.</span></div><span className="module-health"><i /> {instruments.filter((item) => item.kind === 'cvu').length} CVU</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{instruments.length}</strong><span>instrumentos</span></article>
      <article><strong>{transfers.length}</strong><span>transferencias</span></article>
      <article><strong>{debits.filter((item) => item.status === 'pending').length}</strong><span>débitos pendientes</span></article>
      <article><strong>{qrs.filter((item) => item.status === 'active').length}</strong><span>QR activos</span></article>
      <article><strong>{saleOrders.filter((item) => item.status === 'pending').length}</strong><span>órdenes pendientes</span></article>
      <article><strong>{debts.filter((item) => item.status === 'open').length}</strong><span>deudas abiertas</span></article>
    </div>
    <p className="role-boundary-copy">Cimbra emite CVU con prefijo 000 y código PSP 9999, no asignado por Coelsa. El alias se asigna o cambia sobre un CVU existente y vive en el tenant; un cambio real queda bloqueado 24 horas. Un CBU externo se referencia para cash-out a settlement; no se emite CBU porque Cimbra no es banco.</p>

    <div className="compliance-grid wallets-grid">
      {canOperate && <article className="integration-card"><div className="card-head"><div><h2>Emitir CVU sandbox</h2><p>Cuenta ARS argentina · alias opcional</p></div></div>
        <form className="book-statement-body" onSubmit={issue}>
          <label>Cuenta<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Alias opcional<input name="alias" minLength={6} maxLength={20} placeholder="COMERCIO.SUR" /></label>
          <button className="app-primary" disabled={busy || arsAccounts.length === 0}>{busy ? 'Emitiendo…' : 'Emitir CVU'}</button>
        </form>
      </article>}
      {canOperate && instruments.some((item) => item.kind === 'cvu' && item.status === 'active') && <article className="integration-card"><div className="card-head"><div><h2>Asignar o cambiar alias</h2><p>CVU existente · un cambio cada 24 h · unicidad del tenant</p></div></div>
        <form className="book-statement-body" onSubmit={assignAlias}>
          <label>CVU<select name="instrumentId" required defaultValue=""><option value="" disabled>Seleccionar</option>{instruments.filter((item) => item.kind === 'cvu' && item.status === 'active').map((item) => {
            const alias = instruments.find((candidate) => candidate.kind === 'alias' && candidate.accountId === item.accountId && candidate.status === 'active');
            return <option key={item.id} value={item.id}>{item.value} · {alias ? alias.value : 'sin alias'}</option>;
          })}</select></label>
          <label>Alias<input name="alias" required minLength={6} maxLength={20} placeholder="COMERCIO.OESTE" /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar alias'}</button>
        </form>
      </article>}
      <article className="integration-card"><div className="card-head"><div><h2>Directorio sandbox</h2><p>Confirmación de titular BCRA-like</p></div></div>
        <form className="book-statement-body" onSubmit={lookup}>
          <label>CBU, CVU o alias<input name="q" required minLength={6} maxLength={22} placeholder="0009999… o ALIAS.CUENTA" /></label>
          <button className="app-primary" disabled={busy}>Consultar</button>
        </form>
        {preview && <p className="role-boundary-copy">{preview.found ? `${preview.holderName} · CUIT …${preview.taxIdLast4}` : 'Sin titular interno'} · {preview.kind.toUpperCase()} …{preview.last4} · {preview.rail}</p>}
      </article>
    </div>

    {canOperate && <article className="integration-card">
      <div className="card-head"><div><h2>Crédito inmediato</h2><p>Interno si el destino es de este tenant; si no, cash-out sandbox</p></div></div>
      <form className="book-statement-body" onSubmit={transfer}>
        <label>Cuenta origen / destino inbound<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
        <label>Dirección<select name="direction" defaultValue="outbound"><option value="outbound">Saliente</option><option value="inbound">Inbound sandbox</option></select></label>
        <label>Destino CBU/CVU/alias<input name="destination" required minLength={6} maxLength={22} /></label>
        <label>Titular confirmado<input name="holderName" required minLength={2} maxLength={160} /></label>
        <label>CUIT últimos 4<input name="taxIdLast4" required pattern="\d{4}" maxLength={4} /></label>
        <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} /></label>
        <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
        <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <button className="app-primary" disabled={busy}>{busy ? 'Enviando…' : 'Transferir'}</button>
      </form>
    </article>}

    {canOperate && <div className="compliance-grid wallets-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Solicitar débito interno</h2><p>Sólo cuentas Cimbra del tenant</p></div></div>
        <form className="book-statement-body" onSubmit={requestDebit}>
          <label>Cobrador<select name="collectorAccountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Pagador CVU/alias<input name="payerDestination" required minLength={6} maxLength={22} /></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
          <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <button className="app-primary" disabled={busy}>Solicitar débito</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>QR Cimbra</h2><p>Payload propio. El estático es reutilizable y exige CVU activo</p></div></div>
        <form className="book-statement-body" onSubmit={createQr}>
          <label>Cuenta cobradora<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{(qrKind === 'static' ? arsAccounts.filter((account) => instruments.some((item) => item.kind === 'cvu' && item.status === 'active' && item.accountId === account.id)) : arsAccounts).map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
          <label>Tipo<select name="kind" value={qrKind} onChange={(event) => setQrKind(event.target.value === 'static' ? 'static' : 'dynamic')}><option value="dynamic">Dinámico · un pago</option><option value="static">Estático · reutilizable</option></select></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
          {qrKind === 'dynamic' && <label>Monto opcional<input name="amount" type="number" min="0.01" step="0.01" /></label>}
          <button className="app-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear QR'}</button>
        </form>
      </article>
    </div>}

    {canOperate && qrs.some((item) => item.status === 'active') && <article className="integration-card">
      <div className="card-head"><div><h2>Cobrar QR</h2><p>Desde otra cuenta del tenant</p></div></div>
      <form className="book-statement-body" onSubmit={payQr}>
        <label>QR<select name="qrId" required>{qrs.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{qrKindLabel(item.kind)} · {item.payload} · {item.amount === null ? 'abierto' : money(item.amount)}</option>)}</select></label>
        <label>Cuenta pagadora<select name="sourceAccountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
        <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} /></label>
        <label>Monto si es abierto o no hay orden<input name="amount" type="number" min="0.01" step="0.01" /></label>
        <button className="app-primary" disabled={busy}>Pagar QR</button>
      </form>
    </article>}

    {canOperate && qrs.some((item) => item.status === 'active' && item.kind === 'static') && <article className="integration-card">
      <div className="card-head"><div><h2>Orden de venta</h2><p>Monto cerrado sobre un QR estático. Una pendiente por QR</p></div></div>
      <form className="book-statement-body" onSubmit={createSaleOrder}>
        <label>QR estático<select name="paymentQrId" required defaultValue=""><option value="" disabled>Seleccionar</option>{qrs.filter((item) => item.status === 'active' && item.kind === 'static').map((item) => <option key={item.id} value={item.id}>{item.payload}</option>)}</select></label>
        <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} /></label>
        <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
        <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <button className="app-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear orden'}</button>
      </form>
    </article>}

    {canOperate && <article className="integration-card">
      <div className="card-head"><div><h2>QR de deuda</h2><p>Monto cerrado, un pago. Exige CVU sandbox activo</p></div></div>
      <form className="book-statement-body" onSubmit={createDebt}>
        <label>Cuenta cobradora<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{arsAccounts.filter((account) => instruments.some((item) => item.kind === 'cvu' && item.status === 'active' && item.accountId === account.id)).map((account) => <option key={account.id} value={account.id}>{account.accountReference}</option>)}</select></label>
        <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} /></label>
        <label>Concepto<input name="description" required minLength={2} maxLength={180} /></label>
        <label>Monto ARS<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <button className="app-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear deuda'}</button>
      </form>
    </article>}

    <article className="module-list">
      <div className="card-head"><div><h2>Instrumentos</h2><p>CVU y alias del tenant</p></div></div>
      {instruments.length === 0 ? <div className="table-empty">Sin CVU ni alias emitidos.</div>
        : instruments.map((item) => <div key={item.id}><span className="movement"><i>▣</i><b>{item.kind.toUpperCase()} {item.value}<small>{item.accountReference} · {item.holderName} · …{item.taxIdLast4} · {STATUS_LABELS[item.status] ?? item.status}</small></b></span>{canOperate && item.kind === 'cvu' && item.status === 'active' && <button type="button" className="danger-link" disabled={busy} onClick={() => revokeCvu(item.id)}>Eliminar CVU</button>}</div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>Transferencias</h2><p>Crédito, débito interno y QR · alta con política instant_transfer.create y devolución con instant_transfer.return pasan por Aprobaciones</p></div></div>
      {transfers.length === 0 ? <div className="table-empty">Sin transferencias instantáneas.</div>
        : transfers.map((item) => <div key={item.id}><span className="movement"><i>↔</i><b>{item.scheme} · {item.direction}<small>{item.description} · {item.counterpartyKind} …{item.counterpartyLast4} · {STATUS_LABELS[item.status] ?? item.status}</small></b></span><strong>{money(item.amount, item.currency)}</strong>{canOperate && item.status === 'settled' && <button type="button" className="danger-link" disabled={busy} onClick={() => returnTransfer(item.id)}>Devolver</button>}</div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>QR Cimbra</h2><p>Dinámico un pago · estático reutilizable · deuda un pago</p></div></div>
      {qrs.length === 0 ? <div className="table-empty">Sin QR emitidos.</div>
        : qrs.map((item) => <div key={item.id}><span className="movement"><i>▣</i><b>{qrKindLabel(item.kind)} · {item.payload}<small>{item.accountReference} · {item.amount === null ? 'monto abierto' : money(item.amount, item.currency)} · {STATUS_LABELS[item.status] ?? item.status}</small></b></span>{canOperate && item.status === 'active' && <button type="button" className="danger-link" disabled={busy} onClick={() => cancelQr(item.id)}>Cancelar QR</button>}</div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>Órdenes de venta</h2><p>Overlay de monto sobre QR estático</p></div></div>
      {saleOrders.length === 0 ? <div className="table-empty">Sin órdenes de venta.</div>
        : saleOrders.map((item) => <div key={item.id}><span className="movement"><i>▣</i><b>{item.externalReference}<small>{item.qrPayload} · {item.description} · {STATUS_LABELS[item.status] ?? item.status}</small></b></span><strong>{money(item.amount)}</strong>{canOperate && item.status === 'pending' && <button type="button" className="danger-link" disabled={busy} onClick={() => cancelSaleOrder(item.id)}>Eliminar orden</button>}</div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>Deudas QR</h2><p>Un QR por deuda · monto cerrado · un solo pago</p></div></div>
      {debts.length === 0 ? <div className="table-empty">Sin deudas QR.</div>
        : debts.map((item) => <div key={item.id}><span className="movement"><i>▣</i><b>{item.externalReference}<small>{item.payload} · {item.description} · {STATUS_LABELS[item.status] ?? item.status}</small></b></span><strong>{money(item.amount)}</strong>{canOperate && item.status === 'open' && <button type="button" className="danger-link" disabled={busy} onClick={() => cancelDebt(item.id)}>Eliminar deuda</button>}</div>)}
    </article>

    <article className="module-list">
      <div className="card-head"><div><h2>Solicitudes de débito</h2><p>Aceptar o rechazar pendientes</p></div></div>
      {debits.length === 0 ? <div className="table-empty">Sin solicitudes.</div>
        : debits.map((item) => <div key={item.id}><span className="movement"><i>↓</i><b>{item.description}<small>{STATUS_LABELS[item.status] ?? item.status} · {money(item.amount, item.currency)}</small></b></span>{canOperate && item.status === 'pending' && <div className="approval-actions"><button type="button" disabled={busy} onClick={() => respond(item.id, 'accept')}>Aceptar</button><button type="button" className="danger-link" disabled={busy} onClick={() => respond(item.id, 'reject')}>Rechazar</button></div>}</div>)}
    </article>
  </div>;
}
