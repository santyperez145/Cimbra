'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Account = { id: string; accountReference: string; currency: string; balance: number; status: string };
type BookTransfer = {
  id: string; externalReference: string; sourceAccountId: string; sourceAccountReference: string; sourceCustomerName: string;
  destinationAccountId: string; destinationAccountReference: string; destinationCustomerName: string;
  transactionId: string; description: string; amount: number; currency: string; status: string; riskScore: number;
  holdId: string | null; createdAt: string;
};
type StatementEntry = { id: string; kind: string; description: string; signedAmount: number; currency: string; status: string | null; createdAt: string };
type Statement = { account: { id: string; accountReference: string; currency: string }; period: {
  openingBalance: number; closingBalance: number; from: string; to: string;
}; data: StatementEntry[] };

const labels: Record<string, string> = { review: 'En revisión', settled: 'Liquidado', reversed: 'Revertido', cancelled: 'Cancelado' };

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

function errorMessage(body: { error?: string | { message?: string } }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

export default function BookTransfersPanel({ accounts, role, onCashMovement }: {
  accounts: Account[]; role: OrganizationRole; onCashMovement: () => void;
}) {
  const [transfers, setTransfers] = useState<BookTransfer[]>([]); const [statement, setStatement] = useState<Statement | null>(null);
  const [statementAccountId, setStatementAccountId] = useState(accounts[0]?.id ?? ''); const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const canOperate = roleCan(role, 'finance.write');
  const source = accounts.find((account) => account.id === sourceAccountId);
  const destinations = useMemo(() => accounts.filter((account) => account.id !== sourceAccountId && account.status === 'active' && account.currency === source?.currency), [accounts, sourceAccountId, source?.currency]);

  const loadTransfers = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/book-transfers?limit=100', { cache: 'no-store' });
    const body = await response.json() as { data?: BookTransfer[]; error?: string | { message?: string } };
    if (!response.ok) return setFeedback(errorMessage(body)); setTransfers(body.data ?? []);
  }, []);

  const loadStatement = useCallback(async (accountId: string) => {
    if (!accountId) { setStatement(null); return; }
    const response = await authenticatedFetch(`/api/v1/accounts/${accountId}/statement?limit=50`, { cache: 'no-store' });
    const body = await response.json() as Statement & { error?: string | { message?: string } };
    if (!response.ok) return setFeedback(errorMessage(body)); setStatement(body);
  }, []);

  useEffect(() => { const task = window.setTimeout(() => { void loadTransfers(); void loadStatement(statementAccountId); }, 0); return () => window.clearTimeout(task); }, [loadStatement, loadTransfers, statementAccountId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(''); const form = new FormData(event.currentTarget);
    const currentSource = accounts.find((account) => account.id === form.get('sourceAccountId'));
    const response = await authenticatedFetch('/api/v1/book-transfers', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ externalReference: form.get('externalReference'), sourceAccountId: form.get('sourceAccountId'),
        destinationAccountId: form.get('destinationAccountId'), description: form.get('description'),
        amount: form.get('amount'), currency: currentSource?.currency }) });
    const body = await response.json() as { requiresApproval?: boolean; transfer?: BookTransfer; error?: string | { message?: string } };
    if (!response.ok) setFeedback(errorMessage(body));
    else if (body.requiresApproval) setFeedback('Solicitud creada. Otro owner/admin con MFA debe aprobarla en Aprobaciones. Todavía no se reservaron fondos.');
    else setFeedback(body.transfer?.status === 'review' ? 'Book transfer creado con fondos reservados para revisión de riesgo.' : 'Book transfer liquidado con débito y crédito atómicos.');
    if (response.ok) { event.currentTarget.reset(); setSourceAccountId(accounts[0]?.id ?? ''); await loadTransfers(); await loadStatement(statementAccountId); }
    setBusy(false);
  }

  async function reverse(transfer: BookTransfer) {
    if (!window.confirm(`¿Revertir ${transfer.externalReference} con postings compensatorios?`)) return;
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/book-transfers/${transfer.id}/reverse`, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    }); const body = await response.json() as { requiresApproval?: boolean; error?: string | { message?: string } };
    if (!response.ok) setFeedback(errorMessage(body));
    else setFeedback(body.requiresApproval
      ? 'Reversa enviada a Aprobaciones (maker/checker).'
      : 'Book transfer revertido sin modificar el historial original.');
    if (response.ok) { await loadTransfers(); await loadStatement(statementAccountId); } setBusy(false);
  }

  return <div className="module-view book-transfers-console">
    <div className="module-view-head"><div><p>CORE BANKING · BOOK TRANSFERS</p><h1>Transferencias internas</h1><span>Mové saldo entre cuentas Cimbra con postings atómicos, riesgo, doble control y reversas compensatorias.</span></div><span className="module-health"><i /> {transfers.filter((item) => item.status === 'review').length} en revisión</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{transfers.length}</strong><span>book transfers</span></article><article><strong>{transfers.filter((item) => item.status === 'settled').length}</strong><span>liquidados</span></article><article><strong>{accounts.length}</strong><span>cuentas conectadas</span></article></div>
    <div className="approval-layout">
      {canOperate && <article className="integration-card"><div className="card-head"><div><h2>Nuevo book transfer</h2><p>Origen y destino deben compartir moneda</p></div><b>ATÓMICO</b></div><form className="integration-form" onSubmit={create}>
        <label>Referencia externa<input name="externalReference" required minLength={2} maxLength={100} placeholder="BT-2026-0001" /></label>
        <div className="integration-fields"><label>Cuenta origen<select name="sourceAccountId" required value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)}><option value="" disabled>Seleccionar</option>{accounts.filter((account) => account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {money(account.balance, account.currency)}</option>)}</select></label><label>Cuenta destino<select name="destinationAccountId" required defaultValue=""><option value="" disabled>Seleccionar</option>{destinations.map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {account.currency}</option>)}</select></label></div>
        <div className="integration-fields"><label>Monto<input name="amount" type="number" min={source?.currency === 'CLP' ? '1' : '0.01'} step={source?.currency === 'CLP' ? '1' : '0.01'} max="10000000" required /></label><label>Moneda<input value={source?.currency ?? '—'} readOnly aria-label="Moneda" /></label></div>
        <label>Concepto<input name="description" required minLength={2} maxLength={180} placeholder="Distribución de saldo marketplace" /></label>
        <button disabled={busy || destinations.length === 0}>{busy ? 'Procesando…' : 'Transferir entre cuentas'}</button>
      </form><button className="danger-link" type="button" onClick={onCashMovement}>Ir a cash-in / cash-out →</button></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Estado de cuenta</h2><p>Postings reales del ledger, últimos 30 días</p></div><b>INMUTABLE</b></div><div className="book-statement-body"><label>Cuenta<select value={statementAccountId} onChange={(event) => setStatementAccountId(event.target.value)}><option value="" disabled>Seleccionar</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.accountReference} · {account.currency}</option>)}</select></label>{statement ? <><div className="module-metrics"><article><strong>{money(statement.period.openingBalance, statement.account.currency)}</strong><span>saldo inicial</span></article><article><strong>{money(statement.period.closingBalance, statement.account.currency)}</strong><span>saldo final</span></article></div><div className="module-list">{statement.data.length === 0 ? <div><span>Sin postings en el período.</span></div> : statement.data.slice(0, 8).map((entry) => <div key={entry.id}><span className="movement"><i>{entry.signedAmount < 0 ? '↗' : '↙'}</i><b>{entry.description}<small>{entry.kind} · {new Date(entry.createdAt).toLocaleString('es-AR')}</small></b></span><strong className={entry.signedAmount > 0 ? 'positive' : ''}>{entry.signedAmount > 0 ? '+' : ''}{money(entry.signedAmount, entry.currency)}</strong></div>)}</div></> : <p>Seleccioná una cuenta para consultar su ledger.</p>}</div></article>
    </div>
    <article className="module-list"><div className="card-head"><div><h2>Historial de book transfers</h2><p>Una operación, dos legs contables y trazabilidad end-to-end</p></div><b>{transfers.length}</b></div>{transfers.length === 0 ? <div><span className="movement"><i>⇄</i><b>Sin transferencias internas<small>{canOperate ? 'Creá la primera operación entre cuentas' : 'No hay operaciones para consultar'}</small></b></span><strong>Vacío</strong></div> : transfers.map((transfer) => <div key={transfer.id}><span className="movement"><i>⇄</i><b>{transfer.externalReference}<small>{transfer.sourceAccountReference} → {transfer.destinationAccountReference}</small><small>{transfer.sourceCustomerName} → {transfer.destinationCustomerName} · {transfer.description}</small></b></span><span className="approval-actions"><strong>{money(transfer.amount, transfer.currency)}</strong><b className={transfer.status}>{labels[transfer.status] ?? transfer.status}</b>{canOperate && transfer.status === 'settled' && <button disabled={busy} onClick={() => void reverse(transfer)}>Revertir</button>}</span></div>)}</article>
    <p className="role-boundary-copy">Sandbox propio de Cimbra: estos movimientos y estados de cuenta son reales dentro del ledger persistente, pero no representan custodia ni transferencia de dinero por un riel bancario. La salida a redes externas requiere licencia o sponsor, conexión directa y homologación por país.</p>
  </div>;
}
