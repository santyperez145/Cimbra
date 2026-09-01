'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Currency } from '@/app/lib/ledger/money';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { WALLET_POCKET_KINDS, type WalletPocketKind, type WalletStatus } from '@/app/lib/platform/wallets-input';

type Customer = { id: string; name: string; country: string; status: string };
type WalletProgram = {
  id: string; name: string; displayName: string; defaultCurrency: Currency; allowedCurrencies: Currency[];
  pocketKinds: WalletPocketKind[]; status: string; createdAt: string;
};
type Wallet = {
  id: string; programId: string; programName: string; programDisplayName: string; customerId: string; customerName: string;
  externalReference: string; status: WalletStatus; statusReason: string | null; pocketCount: number; createdAt: string;
};
type Pocket = {
  id: string; accountId: string; accountReference: string; kind: WalletPocketKind; label: string;
  currency: Currency; status: string; balance: number; createdAt: string;
};
type LifecycleEvent = { id: string; fromStatus: WalletStatus | null; toStatus: WalletStatus; reason: string; actorName: string; createdAt: string };

const STATUS_LABELS: Record<WalletStatus, string> = { active: 'Activa', frozen: 'Congelada', closed: 'Cerrada' };
const KIND_LABELS: Record<WalletPocketKind, string> = { available: 'Disponible', pending: 'Pendiente', rewards: 'Recompensas' };
const REASON_LABELS: Record<string, string> = {
  issued: 'Apertura', user_request: 'Solicitud del usuario', internal_control: 'Control interno',
  suspected_fraud: 'Fraude sospechado', review_cleared: 'Revisión superada', customer_request: 'Solicitud del cliente',
  compliance: 'Compliance',
};

function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message : fallback;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function localizedDate(value: string) {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function WalletsPanel({ role }: { role: OrganizationRole }) {
  const [programs, setPrograms] = useState<WalletProgram[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pockets, setPockets] = useState<Pocket[]>([]);
  const [lifecycle, setLifecycle] = useState<LifecycleEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const canManagePrograms = roleCan(role, 'wallets.program.manage');
  const selected = wallets.find((wallet) => wallet.id === selectedId) ?? null;
  const sourcePockets = useMemo(() => pockets.filter((pocket) => pocket.status === 'active'), [pockets]);

  const loadInventory = useCallback(async () => {
    const [programResponse, walletResponse, customerResponse] = await Promise.all([
      authenticatedFetch('/api/v1/wallet-programs', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/wallets?limit=100', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/customers?limit=100', { cache: 'no-store' }),
    ]);
    const programResult = await programResponse.json() as { data?: WalletProgram[] };
    const walletResult = await walletResponse.json() as { data?: Wallet[] };
    const customerResult = await customerResponse.json() as { data?: Customer[] };
    if (!programResponse.ok) throw new Error(apiError(programResult, 'No pudimos cargar los programas.'));
    if (!walletResponse.ok) throw new Error(apiError(walletResult, 'No pudimos cargar las wallets.'));
    if (!customerResponse.ok) throw new Error(apiError(customerResult, 'No pudimos cargar los clientes.'));
    const nextWallets = walletResult.data ?? [];
    setPrograms(programResult.data ?? []);
    setWallets(nextWallets);
    setCustomers(customerResult.data ?? []);
    setSelectedId((current) => nextWallets.some((wallet) => wallet.id === current) ? current : nextWallets[0]?.id ?? '');
  }, []);

  const loadDetails = useCallback(async (walletId: string) => {
    if (!walletId) { setPockets([]); setLifecycle([]); return; }
    const [pocketResponse, lifecycleResponse] = await Promise.all([
      authenticatedFetch(`/api/v1/wallets/${walletId}/pockets`, { cache: 'no-store' }),
      authenticatedFetch(`/api/v1/wallets/${walletId}/lifecycle`, { cache: 'no-store' }),
    ]);
    const pocketResult = await pocketResponse.json() as { data?: Pocket[] };
    const lifecycleResult = await lifecycleResponse.json() as { data?: LifecycleEvent[] };
    if (!pocketResponse.ok) throw new Error(apiError(pocketResult, 'No pudimos cargar los bolsillos.'));
    if (!lifecycleResponse.ok) throw new Error(apiError(lifecycleResult, 'No pudimos cargar el ciclo de vida.'));
    setPockets(pocketResult.data ?? []);
    setLifecycle(lifecycleResult.data ?? []);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadInventory().catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [loadInventory]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadDetails(selectedId).catch((error: Error) => setFeedback(error.message)), 0);
    return () => window.clearTimeout(task);
  }, [loadDetails, selectedId]);

  async function createProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const pocketKinds = ['available' as const, ...WALLET_POCKET_KINDS.filter((kind) => kind !== 'available' && form.get(`pocket-${kind}`) === 'on')];
    const response = await authenticatedFetch('/api/v1/wallet-programs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        name: form.get('name'), displayName: form.get('displayName'), defaultCurrency: form.get('currency'),
        allowedCurrencies: [form.get('currency')], pocketKinds: pocketKinds.length ? pocketKinds : ['available'],
        supportUrl: String(form.get('supportUrl') ?? '').trim() || null,
        accentColor: String(form.get('accentColor') ?? '').trim() || null,
      }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? 'Programa de wallet creado. No emite una app de consumidor ni custodia fondos reales.' : apiError(result, 'No pudimos crear el programa.'));
    if (response.ok) { formElement.reset(); await loadInventory(); }
    setBusy(false);
  }

  async function createWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/wallets', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ programId: form.get('programId'), customerId: form.get('customerId'), externalReference: form.get('externalReference') }),
    });
    const result = await response.json() as { wallet?: Wallet };
    setFeedback(response.ok ? 'Wallet abierta con bolsillos conectados al ledger.' : apiError(result, 'No pudimos abrir la wallet.'));
    if (response.ok) { formElement.reset(); await loadInventory(); if (result.wallet?.id) setSelectedId(result.wallet.id); }
    setBusy(false);
  }

  async function transition(status: WalletStatus, reason: string) {
    if (!selected) return;
    if (status === 'closed' && !window.confirm('El cierre es irreversible y exige saldo cero. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/wallets/${selected.id}/lifecycle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ status, reason }),
    });
    const result = await response.json() as unknown;
    setFeedback(response.ok ? `Estado actualizado a ${STATUS_LABELS[status].toLowerCase()}.` : apiError(result, 'No pudimos cambiar el estado.'));
    if (response.ok) { await loadInventory(); await loadDetails(selected.id); }
    setBusy(false);
  }

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    const source = pockets.find((pocket) => pocket.id === form.get('sourcePocketId'));
    const response = await authenticatedFetch(`/api/v1/wallets/${selected.id}/transfers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        externalReference: form.get('externalReference'), sourcePocketId: form.get('sourcePocketId'),
        destinationPocketId: form.get('destinationPocketId'), description: form.get('description'),
        amount: form.get('amount'), currency: source?.currency,
      }),
    });
    const result = await response.json() as { requiresApproval?: boolean; transfer?: { status: string }; error?: unknown };
    if (!response.ok) setFeedback(apiError(result, 'No pudimos mover el saldo.'));
    else if (result.requiresApproval) setFeedback('Solicitud creada. Otro owner/admin con MFA debe aprobarla en Aprobaciones.');
    else setFeedback(result.transfer?.status === 'review' ? 'Movimiento entre bolsillos reservado por riesgo.' : 'Saldo movido entre bolsillos con postings atómicos.');
    if (response.ok) { event.currentTarget.reset(); await loadDetails(selected.id); }
    setBusy(false);
  }

  return <div className="module-view wallets-console">
    <div className="module-view-head"><div><p>EMBEDDED FINANCE · WALLETS</p><h1>Wallets y bolsillos</h1><span>Programas tenant, wallets por cliente y pockets sobre el ledger canónico. No es una app white-label ni custodia de dinero real.</span></div><span className="module-health"><i /> {wallets.filter((item) => item.status === 'active').length} activas</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{programs.length}</strong><span>programas</span></article>
      <article><strong>{wallets.length}</strong><span>wallets</span></article>
      <article><strong>{pockets.length}</strong><span>bolsillos de la seleccionada</span></article>
    </div>
    <p className="role-boundary-copy">Cada bolsillo es una cuenta de producto. Los movimientos entre pockets reutilizan book transfers, riesgo, holds y maker/checker. Congelar o cerrar también inactiva esas cuentas.</p>

    <div className="compliance-grid wallets-grid">
      {canManagePrograms && <article className="integration-card"><div className="card-head"><div><h2>Nuevo programa</h2><p>Owner/Admin configura marca y bolsillos</p></div></div>
        <form className="book-statement-body" onSubmit={createProgram}>
          <label>Nombre interno<input name="name" required minLength={2} maxLength={80} placeholder="Wallet marketplace ARS" /></label>
          <label>Nombre visible<input name="displayName" required minLength={2} maxLength={80} placeholder="Billetera Comercio Sur" /></label>
          <label>Moneda<select name="currency" defaultValue="ARS"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label>
          <label>Color de marca<input name="accentColor" placeholder="#C45C26" pattern="^#[0-9A-Fa-f]{6}$" /></label>
          <label>URL de soporte<input name="supportUrl" type="url" placeholder="https://soporte.ejemplo.com" /></label>
          <fieldset><legend>Bolsillos</legend>{WALLET_POCKET_KINDS.map((kind) => <label key={kind}><input type="checkbox" name={`pocket-${kind}`} defaultChecked={kind === 'available'} disabled={kind === 'available'} /> {KIND_LABELS[kind]}{kind === 'available' ? ' (obligatorio)' : ''}</label>)}</fieldset>
          <button className="app-primary" disabled={busy}>{busy ? 'Guardando…' : 'Crear programa'}</button>
        </form>
      </article>}

      {canOperate && <article className="integration-card"><div className="card-head"><div><h2>Abrir wallet</h2><p>Un cliente, un programa, bolsillos en ledger</p></div></div>
        <form className="book-statement-body" onSubmit={createWallet}>
          <label>Programa<select name="programId" required defaultValue=""><option value="" disabled>Seleccionar programa</option>{programs.filter((item) => item.status === 'active').map((program) => <option key={program.id} value={program.id}>{program.displayName}</option>)}</select></label>
          <label>Cliente<select name="customerId" required defaultValue=""><option value="" disabled>Seleccionar cliente</option>{customers.filter((item) => item.status === 'active').map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label>Referencia externa<input name="externalReference" required minLength={2} maxLength={100} placeholder="WALLET-001" /></label>
          <button className="app-primary" disabled={busy || programs.length === 0 || customers.length === 0}>{busy ? 'Abriendo…' : 'Abrir wallet'}</button>
        </form>
      </article>}
    </div>

    <article className="module-list">
      <div className="card-head"><div><h2>Wallets del tenant</h2><p>Seleccioná una para ver bolsillos y lifecycle</p></div><b>LEDGER-BACKED</b></div>
      {wallets.length === 0 ? <div className="table-empty">No hay wallets. {canOperate ? 'Creá un programa y abrí la primera.' : 'No hay wallets para consultar.'}</div>
        : wallets.map((wallet) => <button type="button" key={wallet.id} className={wallet.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(wallet.id)}>
          <span className="movement"><i>▣</i><b>{wallet.programDisplayName}<small>{wallet.customerName} · {wallet.externalReference}</small></b></span>
          <strong>{STATUS_LABELS[wallet.status]}</strong>
        </button>)}
    </article>

    {selected && <>
      <article className="module-list">
        <div className="card-head"><div><h2>Bolsillos</h2><p>{selected.customerName} · {selected.pocketCount} pockets</p></div>
          {canOperate && selected.status === 'active' && <div className="approval-actions">
            <button type="button" disabled={busy} onClick={() => transition('frozen', 'internal_control')}>Congelar</button>
            <button type="button" className="danger-link" disabled={busy} onClick={() => transition('closed', 'customer_request')}>Cerrar</button>
          </div>}
          {canOperate && selected.status === 'frozen' && <div className="approval-actions">
            <button type="button" disabled={busy} onClick={() => transition('active', 'review_cleared')}>Reactivar</button>
            <button type="button" className="danger-link" disabled={busy} onClick={() => transition('closed', 'compliance')}>Cerrar</button>
          </div>}
        </div>
        {pockets.length === 0 ? <div className="table-empty">Sin bolsillos.</div>
          : pockets.map((pocket) => <div key={pocket.id}><span className="movement"><i>◉</i><b>{pocket.label}<small>{pocket.accountReference} · {pocket.status}</small></b></span><strong>{money(pocket.balance, pocket.currency)}</strong></div>)}
      </article>

      {canOperate && selected.status === 'active' && sourcePockets.length > 1 && <article className="integration-card">
        <div className="card-head"><div><h2>Mover entre bolsillos</h2><p>Book transfer interno con riesgo y doble control</p></div></div>
        <form className="book-statement-body" onSubmit={transfer}>
          <label>Origen<select name="sourcePocketId" required>{sourcePockets.map((pocket) => <option key={pocket.id} value={pocket.id}>{pocket.label} · {money(pocket.balance, pocket.currency)}</option>)}</select></label>
          <label>Destino<select name="destinationPocketId" required>{sourcePockets.map((pocket) => <option key={pocket.id} value={pocket.id}>{pocket.label}</option>)}</select></label>
          <label>Referencia<input name="externalReference" required minLength={2} maxLength={100} placeholder="WP-001" /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} placeholder="Distribución interna" /></label>
          <label>Monto<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <button className="app-primary" disabled={busy}>{busy ? 'Moviendo…' : 'Transferir entre pockets'}</button>
        </form>
      </article>}

      <article className="module-list">
        <div className="card-head"><div><h2>Lifecycle</h2><p>Eventos append-only</p></div></div>
        {lifecycle.length === 0 ? <div className="table-empty">Sin eventos.</div>
          : lifecycle.map((event) => <div key={event.id}><span className="movement"><i>✓</i><b>{STATUS_LABELS[event.toStatus]}<small>{REASON_LABELS[event.reason] ?? event.reason} · {event.actorName} · {localizedDate(event.createdAt)}</small></b></span></div>)}
      </article>
    </>}
    {!canOperate && <p className="role-boundary-copy">Tu rol sólo consulta programas, wallets y bolsillos.</p>}
  </div>;
}
