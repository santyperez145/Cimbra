'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; balance: number; status: string };
type Journal = {
  id: string; kind: string; description: string; currency: string; amount: number; postedAt: string; status: string;
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function apiError(body: { error?: string | { message?: string } }, fallback: string) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? fallback;
}

export default function PaymentsPanel({ accounts, role }: { accounts: Account[]; role: OrganizationRole }) {
  const router = useRouter();
  const canOperate = roleCan(role, 'finance.write');
  const [direction, setDirection] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [payments, setPayments] = useState<Journal[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/ledger', { cache: 'no-store' });
    const body = await response.json() as { data?: { journals: Journal[] }; error?: string | { message?: string } };
    if (!response.ok || !body.data) {
      setFeedback(apiError(body, 'No pudimos cargar los payments.'));
      return;
    }
    setPayments(body.data.journals.filter((item) => item.kind === 'cash_in' || item.kind === 'cash_out'));
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const account = accounts.find((item) => item.id === form.get('accountId'));
    const response = await authenticatedFetch('/api/v1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        accountId: account?.id,
        direction,
        counterparty: form.get('counterparty'),
        description: form.get('description'),
        amount: form.get('amount'),
        currency: account?.currency,
      }),
    });
    const body = await response.json() as { payment?: { status: string }; error?: string | { message?: string } };
    if (!response.ok) setFeedback(apiError(body, 'No pudimos procesar el payment.'));
    else {
      setFeedback(body.payment?.status === 'review' ? 'Cash-out enviado a revisión de riesgo.' : 'Payment contabilizado en el ledger sandbox.');
      event.currentTarget.reset();
      await load();
      router.refresh();
    }
    setBusy(false);
  }

  const operable = accounts.filter((account) => account.status === 'active');

  return <div className="module-view">
    <div className="module-view-head">
      <div>
        <p>PAYMENT METHODS · SANDBOX</p>
        <h1>Cash-in y cash-out</h1>
        <span>Ingresos y egresos contra una cuenta de producto. Generan postings y auditoría; no llaman a un banco ni a un BaaS competidor.</span>
      </div>
      <span className="module-health"><i /> {payments.length} cash movements</span>
    </div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{operable.length}</strong><span>cuentas activas</span></article>
      <article><strong>{payments.filter((item) => item.kind === 'cash_in').length}</strong><span>cash-in</span></article>
      <article><strong>{payments.filter((item) => item.kind === 'cash_out').length}</strong><span>cash-out</span></article>
    </div>
    <div className="approval-layout">
      {canOperate && <article className="integration-card">
        <div className="card-head"><div><h2>Nuevo payment</h2><p>POST /api/v1/payments con idempotencia</p></div><b>LEDGER</b></div>
        <form className="integration-form" onSubmit={create}>
          <label>Dirección
            <select value={direction} onChange={(event) => setDirection(event.target.value as 'cash_in' | 'cash_out')}>
              <option value="cash_in">Cash-in · ingreso</option>
              <option value="cash_out">Cash-out · egreso</option>
            </select>
          </label>
          <label>Cuenta
            <select name="accountId" required defaultValue="">
              <option value="" disabled>Seleccionar cuenta</option>
              {operable.map((account) => (
                <option key={account.id} value={account.id}>{account.accountReference} · {money(account.balance, account.currency)}</option>
              ))}
            </select>
          </label>
          <label>Contraparte<input name="counterparty" required minLength={2} maxLength={120} placeholder="Banco, sponsor o beneficiario" /></label>
          <label>Concepto<input name="description" required minLength={2} maxLength={180} placeholder="Fondeo o liquidación sandbox" /></label>
          <label>Monto<input name="amount" type="number" min="0.01" max="10000000" step="0.01" required /></label>
          <button disabled={busy || operable.length === 0}>{busy ? 'Procesando…' : 'Procesar payment'}</button>
        </form>
      </article>}
      <article className="integration-card">
        <div className="card-head"><div><h2>Historial cash</h2><p>Journals cash_in / cash_out del ledger</p></div><b>{payments.length}</b></div>
        <div className="module-list">
          {payments.length === 0
            ? <div className="table-empty">{canOperate ? 'Registrá el primer cash-in o cash-out.' : 'No hay payments para consultar.'}</div>
            : payments.map((item) => (
              <div key={item.id}>
                <span className="movement"><i>{item.kind === 'cash_in' ? '↙' : '↗'}</i><b>{item.description}<small>{item.kind} · {new Date(item.postedAt).toLocaleString('es-AR')}</small></b></span>
                <strong className={item.kind === 'cash_in' ? 'positive' : ''}>{item.kind === 'cash_in' ? '+' : '-'}{money(item.amount, item.currency)}</strong>
              </div>
            ))}
        </div>
      </article>
    </div>
    {!canOperate && <p className="role-boundary-copy">Viewer: sólo lectura del historial cash. Las altas requieren operator, admin u owner.</p>}
    <p className="role-boundary-copy">Sandbox: no mueve fondos reales ni usa adaptadores regionales. Distinto de book transfers (entre cuentas Cimbra) y de Pagos AR (instrumentos locales).</p>
  </div>;
}
