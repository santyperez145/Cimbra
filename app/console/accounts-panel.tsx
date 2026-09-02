'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CURRENCIES, type Currency, minorToMajorNumber } from '@/app/lib/ledger/money';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { ORGANIZATION_COUNTRIES } from '@/app/lib/platform/support-input';

type Account = {
  id: string; customerId: string; currency: Currency; country: string; accountReference: string;
  balance?: number; balanceMinor?: string; status: string; createdAt: string;
};
type Customer = { id: string; name: string; country: string; status: string };
type StatementEntry = { id: string; kind: string; description: string; signedAmount: number; currency: string; status: string | null; createdAt: string };
type Statement = {
  account: { id: string; accountReference: string; currency: string };
  period: { openingBalance: number; closingBalance: number; from: string; to: string };
  data: StatementEntry[];
};
type CurrencyBalance = { currency: string; available: number; current: number; held: number };

const COUNTRY_LABELS: Record<string, string> = {
  AR: 'Argentina', MX: 'México', CO: 'Colombia', BR: 'Brasil', CL: 'Chile', PE: 'Perú',
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

function accountBalance(account: Account) {
  if (typeof account.balance === 'number') return account.balance;
  if (account.balanceMinor) return minorToMajorNumber(account.balanceMinor, account.currency);
  return 0;
}

export default function AccountsPanel({ role, balances }: { role: OrganizationRole; balances: CurrencyBalance[] }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Account | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [query, setQuery] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<'all' | Currency>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draftCountry, setDraftCountry] = useState('AR');
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');
  const canWrite = roleCan(role, 'finance.write');
  const customerNames = useMemo(() => Object.fromEntries(customers.map((item) => [item.id, item.name])), [customers]);
  const activeCustomers = customers.filter((item) => item.status === 'active');

  const loadMore = useCallback(async (cursor: string) => {
    const response = await authenticatedFetch(`/api/v1/accounts?limit=50&cursor=${encodeURIComponent(cursor)}`, { cache: 'no-store' });
    const result = await response.json() as { data?: Account[]; nextCursor?: string | null; error?: unknown };
    if (!response.ok || !result.data) throw new Error(apiError(result, 'No pudimos paginar las cuentas.'));
    setAccounts((current) => [...current, ...result.data!]);
    setNextCursor(result.nextCursor ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      authenticatedFetch('/api/v1/accounts?limit=50', { cache: 'no-store' }),
      authenticatedFetch('/api/v1/customers?limit=100', { cache: 'no-store' }),
    ]).then(async ([accountResponse, customerResponse]) => {
      const accountResult = await accountResponse.json() as { data?: Account[]; nextCursor?: string | null; error?: unknown };
      const customerResult = await customerResponse.json() as { data?: Customer[]; error?: unknown };
      if (!active) return;
      if (!accountResponse.ok || !accountResult.data) setFeedback(apiError(accountResult, 'No pudimos cargar las cuentas.'));
      else {
        setAccounts(accountResult.data);
        setNextCursor(accountResult.nextCursor ?? null);
        setSelectedId((current) => current && accountResult.data!.some((item) => item.id === current) ? current : accountResult.data![0]?.id ?? '');
      }
      if (!customerResponse.ok) setFeedback((current) => current || apiError(customerResult, 'No pudimos cargar los clientes.'));
      else setCustomers(customerResult.data ?? []);
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con el núcleo de cuentas.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void Promise.all([
      authenticatedFetch(`/api/v1/accounts/${selectedId}`, { cache: 'no-store' }),
      authenticatedFetch(`/api/v1/accounts/${selectedId}/statement?limit=50`, { cache: 'no-store' }),
    ]).then(async ([accountResponse, statementResponse]) => {
      const account = await accountResponse.json() as Account & { error?: unknown };
      const body = await statementResponse.json() as Statement & { error?: unknown };
      if (!active) return;
      if (accountResponse.ok && account.id) setDetail(account);
      else setFeedback(apiError(account, 'No pudimos abrir la cuenta.'));
      if (statementResponse.ok && body.account) setStatement(body);
      else setFeedback((current) => current || apiError(body, 'No pudimos cargar el estado de cuenta.'));
    }).catch(() => { if (active) setFeedback('No pudimos conectar con el núcleo de cuentas.'); });
    return () => { active = false; };
  }, [selectedId]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        customerId: values.get('customerId'), currency: values.get('currency'), country: values.get('country'),
      }),
    });
    const result = await response.json() as { account?: Account; replayed?: boolean; error?: unknown };
    if (response.ok && result.account) {
      form.reset();
      setDraftCountry('AR');
      setComposing(false);
      setAccounts((current) => [result.account!, ...current.filter((item) => item.id !== result.account!.id)]);
      setSelectedId(result.account.id);
      setFeedback(result.replayed
        ? 'Esa alta ya existía: la clave de idempotencia evitó un duplicado.'
        : 'Cuenta abierta sobre el ledger de doble partida. No es CBU/CVU ni una cuenta bancaria.');
      router.refresh();
    } else setFeedback(apiError(result, 'No pudimos abrir la cuenta.'));
    setBusy(false);
  }

  const visible = accounts.filter((item) => {
    if (currencyFilter !== 'all' && item.currency !== currencyFilter) return false;
    const needle = query.trim().toLowerCase();
    const owner = customerNames[item.customerId] ?? '';
    return !needle || `${item.accountReference} ${item.id} ${item.currency} ${owner}`.toLowerCase().includes(needle);
  });
  const selected = detail && detail.id === selectedId ? detail : accounts.find((item) => item.id === selectedId) ?? null;
  const usedCurrencies = [...new Set(accounts.map((item) => item.currency))];

  return <div className="module-view operations-view">
    <div className="module-view-head">
      <div>
        <p>CORE & LEDGER</p>
        <h1>Cuentas de producto</h1>
        <span>Cada cuenta pertenece a un cliente, tiene una sola moneda y asienta sobre el ledger. No es CBU, CVU ni cuenta bancaria.</span>
      </div>
      {canWrite && <button className="app-primary" onClick={() => setComposing((value) => !value)}>{composing ? 'Cancelar' : '+ Nueva cuenta'}</button>}
    </div>
    {balances.length > 0 && <div className="module-metrics ledger-balances">{balances.map((balance) => <article key={balance.currency}>
      <small>{balance.currency}</small>
      <strong>{money(balance.available, balance.currency)}</strong>
      <span>Contable {money(balance.current, balance.currency)} · Reservado {money(balance.held, balance.currency)}</span>
    </article>)}</div>}
    <div className="module-metrics">
      <article><strong>{accounts.length}</strong><span>cuentas cargadas</span></article>
      <article><strong>{accounts.filter((item) => item.status === 'active').length}</strong><span>activas</span></article>
      <article><strong>{usedCurrencies.join(' · ') || '—'}</strong><span>monedas en el tenant</span></article>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {composing && canWrite && <form className="case-form support-compose" onSubmit={createAccount}>
      <div>
        <label>Cliente<select name="customerId" required defaultValue="" onChange={(event) => {
          const owner = customers.find((item) => item.id === event.target.value);
          if (owner) setDraftCountry(owner.country);
        }}><option value="" disabled>Seleccionar cliente</option>{activeCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {COUNTRY_LABELS[customer.country] ?? customer.country}</option>)}</select></label>
        <label>Moneda<select name="currency" defaultValue="ARS">{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
      </div>
      <label>País de la cuenta<select name="country" value={draftCountry} onChange={(event) => setDraftCountry(event.target.value)}>{ORGANIZATION_COUNTRIES.map((country) => <option key={country} value={country}>{COUNTRY_LABELS[country]}</option>)}</select></label>
      <div className="case-actions"><button disabled={busy || activeCustomers.length === 0}>Abrir cuenta</button></div>
      {activeCustomers.length === 0 && <p className="operations-empty">Primero da de alta un cliente activo en Clientes.</p>}
    </form>}
    {!canWrite && <p className="operations-empty">Tu rol puede consultar cuentas y estados de cuenta, pero no abrirlas.</p>}
    <div className="operations-layout">
      <article className="operations-queue">
        <div className="module-toolbar">
          <input aria-label="Buscar cuenta" placeholder="⌕ Referencia, cliente o moneda" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div>
            <button className={currencyFilter === 'all' ? 'active' : ''} onClick={() => setCurrencyFilter('all')}>Todas</button>
            {usedCurrencies.map((currency) => <button key={currency} className={currencyFilter === currency ? 'active' : ''} onClick={() => setCurrencyFilter(currency)}>{currency}</button>)}
          </div>
        </div>
        {busy && accounts.length === 0 ? <p className="operations-empty">Cargando cuentas…</p> : visible.length === 0
          ? <p className="operations-empty">{accounts.length === 0 ? 'Todavía no hay cuentas en este tenant.' : 'Ninguna cuenta coincide con el filtro.'}</p>
          : visible.map((item) => <button key={item.id} className={`work-item-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
            <span className={`work-priority ${item.status === 'active' ? 'low' : 'high'}`} />
            <span><strong>{item.accountReference}</strong><small>{customerNames[item.customerId] ?? item.customerId} · {COUNTRY_LABELS[item.country] ?? item.country}</small></span>
            <span><b>{item.currency}</b><small>moneda</small></span>
            <em className={item.status === 'active' ? 'sla-on_track' : 'sla-none'}>{money(accountBalance(item), item.currency)}</em>
          </button>)}
        {nextCursor && <div className="case-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void loadMore(nextCursor).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'No pudimos paginar.')).finally(() => setBusy(false)); }}>Cargar más</button></div>}
      </article>
      <aside className="operations-detail">
        {!selected ? <p className="operations-empty">Seleccioná una cuenta para ver el estado de cuenta.</p> : <>
          <div className="operations-detail-head">
            <div><small>{selected.currency} · {COUNTRY_LABELS[selected.country] ?? selected.country}</small><h2>{selected.accountReference}</h2><p>{selected.id}</p></div>
            <span className={`priority-badge ${selected.status === 'active' ? 'low' : 'high'}`}>{selected.status === 'active' ? 'Activa' : selected.status}</span>
          </div>
          <div className="case-facts">
            <span><small>Titular</small><strong>{customerNames[selected.customerId] ?? selected.customerId}</strong></span>
            <span><small>Saldo ledger</small><strong>{money(accountBalance(selected), selected.currency)}</strong></span>
            <span><small>Alta</small><strong>{new Date(selected.createdAt).toLocaleString('es-AR')}</strong></span>
          </div>
          <section className="case-thread">
            <h3>Estado de cuenta · 30 días</h3>
            {statement && statement.account.id === selected.id ? <>
              <div className="case-facts">
                <span><small>Apertura</small><strong>{money(statement.period.openingBalance, selected.currency)}</strong></span>
                <span><small>Cierre</small><strong>{money(statement.period.closingBalance, selected.currency)}</strong></span>
              </div>
              {statement.data.length === 0 ? <p>Sin postings en el período.</p> : statement.data.map((entry) => <article key={entry.id}>
                <strong>{entry.description || entry.kind}</strong>
                <small>{new Date(entry.createdAt).toLocaleString('es-AR')}{entry.status ? ` · ${entry.status}` : ''}</small>
                <p>{entry.signedAmount > 0 ? '+' : ''}{money(entry.signedAmount, entry.currency)}</p>
              </article>)}
            </> : <p>Cargando estado de cuenta…</p>}
            <p>Las correcciones se hacen con reversas. Este saldo no viaja por Coelsa ni un banco patrocinante.</p>
          </section>
        </>}
      </aside>
    </div>
    <article className="module-list">
      <div className="card-head"><div><h2>Reglas del núcleo</h2><p>Garantías activas en PostgreSQL</p></div><b>DOUBLE ENTRY</b></div>
      <div><span className="movement"><i>＝</i><b>Partida doble<small>Cada journal exige débitos iguales a créditos</small></b></span><strong>Obligatorio</strong></div>
      <div><span className="movement"><i>⌁</i><b>Inmutabilidad<small>Las correcciones se realizan mediante reversas</small></b></span><strong>Activo</strong></div>
      <div><span className="movement"><i>¤</i><b>Unidades mínimas<small>BIGINT por moneda, sin punto flotante</small></b></span><strong>Activo</strong></div>
    </article>
  </div>;
}
