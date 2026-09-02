'use client';

import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Balance = { currency: string; current: number; available: number; held: number };
type Journal = {
  id: string; transactionId: string | null; kind: string; description: string; currency: string;
  status: string; amount: number; postingCount: number; postedAt: string; reversalOf: string | null;
};
type Hold = {
  id: string; transactionId: string; amount: number; currency: string; status: string;
  counterparty: string; description: string; createdAt: string;
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function apiError(body: { error?: string | { message?: string } }, fallback: string) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? fallback;
}

export default function LedgerPanel() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/ledger', { cache: 'no-store' });
    const body = await response.json() as {
      data?: { balances: Balance[]; journals: Journal[]; holds: Hold[] };
      error?: string | { message?: string };
    };
    if (!response.ok || !body.data) {
      setFeedback(apiError(body, 'No pudimos cargar el ledger.'));
      return;
    }
    setBalances(body.data.balances);
    setJournals(body.data.journals);
    setHolds(body.data.holds);
  }, []);

  useEffect(() => {
    let active = true;
    const task = window.setTimeout(() => {
      void load().finally(() => { if (active) setBusy(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(task); };
  }, [load]);

  return <div className="module-view">
    <div className="module-view-head">
      <div>
        <p>FINANCIAL CORE · LEDGER</p>
        <h1>Libro mayor</h1>
        <span>Saldos, journals y holds del ledger de doble partida. Sólo lectura: las correcciones se hacen con reversas en el flujo de origen.</span>
      </div>
      <span className="module-health"><i /> {busy ? 'Cargando…' : `${journals.length} journals`}</span>
    </div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{balances.length}</strong><span>monedas</span></article>
      <article><strong>{journals.length}</strong><span>journals</span></article>
      <article><strong>{holds.length}</strong><span>holds activos</span></article>
    </div>
    <article className="module-list">
      <div className="card-head"><div><h2>Saldos por moneda</h2><p>Contable, disponible y reservado</p></div><b>DOBLE PARTIDA</b></div>
      {balances.length === 0 ? <div className="table-empty">Sin saldos todavía.</div> : balances.map((balance) => (
        <div key={balance.currency}>
          <span className="movement"><i>◈</i><b>{balance.currency}<small>Contable {money(balance.current, balance.currency)} · Reservado {money(balance.held, balance.currency)}</small></b></span>
          <strong>{money(balance.available, balance.currency)}</strong>
        </div>
      ))}
    </article>
    <article className="module-list">
      <div className="card-head"><div><h2>Journals recientes</h2><p>Hasta 100 asientos; no se editan</p></div><b>{journals.length}</b></div>
      {journals.length === 0 ? <div className="table-empty">Todavía no hay journals posteados.</div> : journals.map((journal) => (
        <div key={journal.id}>
          <span className="movement">
            <i>{journal.reversalOf ? '↺' : '≡'}</i>
            <b>{journal.description}
              <small>{journal.kind} · {journal.postingCount} postings · {new Date(journal.postedAt).toLocaleString('es-AR')}</small>
              {journal.transactionId && <small>tx {journal.transactionId.slice(0, 8)}…</small>}
            </b>
          </span>
          <strong>{money(journal.amount, journal.currency)}</strong>
        </div>
      ))}
    </article>
    {holds.length > 0 && <article className="module-list">
      <div className="card-head"><div><h2>Holds activos</h2><p>Reservas que restan del disponible</p></div><b>{holds.length}</b></div>
      {holds.map((hold) => (
        <div key={hold.id}>
          <span className="movement"><i>!</i><b>{hold.counterparty}<small>{hold.description}</small></b></span>
          <strong>{money(hold.amount, hold.currency)}</strong>
        </div>
      ))}
    </article>}
    <p className="role-boundary-copy">El ledger sandbox es persistente e inmutable. No representa custodia ni cámara: live exige riel oficial y adaptador Cimbra.</p>
  </div>;
}
