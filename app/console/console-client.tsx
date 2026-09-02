'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormEvent, useState, useSyncExternalStore } from 'react';
import type { DashboardData } from '@/db/runtime';
import { ROLE_PROFILES, roleCan, type AccessCapability, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import AccessPanel from './access-panel';
import AccountsPanel from './accounts-panel';
import ApprovalsPanel from './approvals-panel';
import AuditPanel from './audit-panel';
import BillersPanel from './billers-panel';
import BookTransfersPanel from './book-transfers-panel';
import CardsPanel from './cards-panel';
import CompliancePanel from './compliance-panel';
import DevelopersPanel from './developers-panel';
import DisputesPanel from './disputes-panel';
import OperationsPanel from './operations-panel';
import PlatformPanel from './platform-panel';
import PayoutsPanel from './payouts-panel';
import ReconciliationPanel from './reconciliation-panel';
import RiskPanel from './risk-panel';
import SecurityPanel from './security-panel';
import SupportPanel from './support-panel';
import TransfersPanel from './transfers-panel';
import OrganizationPanel from './organization-panel';
import WalletsPanel from './wallets-panel';
import InstantPaymentsPanel from './instant-payments-panel';
import CollectionsPanel from './collections-panel';
import CustomersPanel from './customers-panel';
import EcheqsPanel from './echeqs-panel';

type Role = OrganizationRole;
const nav: Array<{ icon: string; label: string; capability?: AccessCapability }> = [
  { icon: '▦', label: 'Vista general' }, { icon: '↔', label: 'Movimientos' }, { icon: '⇄', label: 'Payments' }, { icon: '≡', label: 'Payouts' }, { icon: '⌁', label: 'Servicios' },
  { icon: '◍', label: 'Clientes' }, { icon: '◉', label: 'Cuentas' }, { icon: '▣', label: 'Wallets' }, { icon: '⚡', label: 'Pagos AR' }, { icon: '◎', label: 'Cobranzas' }, { icon: '▭', label: 'ECHEQ' }, { icon: '▰', label: 'Tarjetas' }, { icon: '◇', label: 'Riesgo' },
  { icon: '◫', label: 'Disputas', capability: 'disputes.read' }, { icon: '≋', label: 'Conciliación' }, { icon: '☷', label: 'Operaciones' }, { icon: '⚖', label: 'Aprobaciones' }, { icon: '✓', label: 'Compliance' }, { icon: '⌘', label: 'Plataforma' },
  { icon: '⌁', label: 'Developers', capability: 'credentials.manage' }, { icon: '♙', label: 'Accesos', capability: 'organization.manage' },
  { icon: '⌂', label: 'Organización' }, { icon: '☎', label: 'Soporte' }, { icon: '☰', label: 'Auditoría' }, { icon: '⌾', label: 'Seguridad' },
];

function money(value: number, currency = 'ARS') {
  const decimals = currency === 'CLP' ? 0 : 2;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function statusLabel(status: string) {
  return ({ settled: 'Liquidado', authorized: 'Autorizado', review: 'En revisión', pending: 'Pendiente', reversed: 'Revertido', cancelled: 'Cancelado' } as Record<string, string>)[status] ?? status;
}

export default function ConsoleClient({ data, user, platformOperator = false }: {
  data: DashboardData;
  user: { userId: string; displayName: string; email: string; role: Role; emailVerified: boolean; mfaEnabled: boolean; recoveryCodeCount: number };
  platformOperator?: boolean;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [active, setActive] = useState('Vista general');
  const [transferOpen, setTransferOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [shellFeedback, setShellFeedback] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [transferCurrency, setTransferCurrency] = useState('ARS');
  const [paymentDirection, setPaymentDirection] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [overviewPeriod, setOverviewPeriod] = useState<'7d' | '30d'>('30d');
  const [ledgerEpoch, setLedgerEpoch] = useState(0);
  const canOperate = roleCan(user.role, 'finance.write');
  const canManageOrganization = roleCan(user.role, 'organization.manage');
  const visibleNav = nav.filter((item) => !item.capability || roleCan(user.role, item.capability));
  const primaryBalance = data.balances.find((balance) => balance.currency === 'ARS') ?? data.balances[0];
  const overviewSummary = data.periodSummaries[overviewPeriod];
  const overviewDays = overviewPeriod === '7d' ? 7 : 30;
  const overviewTransactions = data.transactions
    .filter((transaction) => Date.parse(transaction.createdAt) >= Date.parse(data.periodAsOf) - overviewDays * 24 * 60 * 60 * 1_000)
    .slice(0, 5);

  if (!mounted) return <main className="app-shell" aria-busy="true" aria-label="Cargando consola" />;

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setShellFeedback('');
    const response = await authenticatedFetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      setShellFeedback(result.error ?? 'No pudimos cerrar la sesión. Reintentá.');
      setSigningOut(false);
      return;
    }
    router.push('/login');
    router.refresh();
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await authenticatedFetch('/api/v1/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ counterparty: form.get('counterparty'), description: form.get('description'), amount: form.get('amount'), currency: form.get('currency') }),
    });
    const result = await response.json() as { error?: string | { message?: string }; requiresApproval?: boolean; transaction?: { status: string } };
    const errorMessage = typeof result.error === 'string' ? result.error : result.error?.message;
    if (!response.ok) setFeedback(errorMessage ?? 'No pudimos crear la transferencia.');
    else if (result.requiresApproval) { setFeedback('Solicitud creada. Otro owner/admin con MFA debe aprobarla desde Aprobaciones.'); setTransferOpen(false); setLedgerEpoch((value) => value + 1); }
    else { setFeedback(result.transaction?.status === 'review' ? 'Transferencia creada y enviada a revisión.' : 'Transferencia liquidada en sandbox.'); setTransferOpen(false); setLedgerEpoch((value) => value + 1); router.refresh(); }
    setBusy(false);
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const account = data.accounts.find((item) => item.id === form.get('accountId'));
    const response = await authenticatedFetch('/api/v1/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ accountId: account?.id, direction: paymentDirection, counterparty: form.get('counterparty'),
        description: form.get('description'), amount: form.get('amount'), currency: account?.currency }),
    });
    const result = await response.json() as { error?: { message?: string } | string; payment?: { status: string } };
    const error = typeof result.error === 'string' ? result.error : result.error?.message;
    if (!response.ok) setFeedback(error ?? 'No pudimos procesar el payment.');
    else { setFeedback(result.payment?.status === 'review' ? 'Cash-out enviado a revisión.' : 'Payment contabilizado correctamente.'); setPaymentOpen(false); setLedgerEpoch((value) => value + 1); router.refresh(); }
    setBusy(false);
  }

  async function resolveReview(holdId: string, action: 'capture' | 'release') {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/holds/${holdId}/${action}`, {
      method: 'POST', headers: { 'Idempotency-Key': `hold-${action}-${holdId}` },
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? action === 'capture' ? 'Reserva capturada y contabilizada.' : 'Reserva liberada sin afectar el saldo contable.' : result.error ?? 'No pudimos resolver la reserva.');
    setBusy(false); router.refresh();
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" href="/"><span className="brand-mark"><i /><i /><i /></span><b>CIMBRA</b></Link>
        <div className="workspace-switch"><small>ORGANIZACIÓN</small><strong>{data.organizationName}</strong><span>Sandbox · Argentina</span></div>
        <nav aria-label="Consola">
          {visibleNav.map(({ icon, label }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)}><i>{icon}</i>{label}</button>)}
        </nav>
        <label className="mobile-console-nav"><span>MÓDULO</span><select aria-label="Módulo de consola" value={active} onChange={(event) => setActive(event.target.value)}>{visibleNav.map(({ label }) => <option key={label}>{label}</option>)}</select></label>
        <button type="button" className="app-help" onClick={() => setActive('Soporte')}><strong>Centro de ayuda</strong><span>Abrí un caso y seguí su historial</span></button>
        {platformOperator && <Link className="app-help" href="/ops"><strong>Superadministración</strong><span>Plano de control multi-tenant</span></Link>}
        <button className="app-user" onClick={signOut} title="Cerrar sesión" disabled={signingOut}><b>{user.displayName.slice(0, 2).toUpperCase()}</b><span><strong>{user.displayName}</strong><small>{user.email} · {ROLE_PROFILES[user.role].label}</small></span><i>↗</i></button>
      </aside>

      <section className="app-main">
        <header className="app-topbar"><div><small>CONSOLA /</small><strong>{active}</strong><span className={`role-posture role-${user.role}`}>{ROLE_PROFILES[user.role].posture}</span></div><div className="app-top-actions"><span className="live-pill"><i /> Base y ledger operativos</span>{canOperate && <button className="app-primary" onClick={() => setTransferOpen(true)}>+ Nueva transferencia</button>}</div></header>
        <div className="app-content">
          {shellFeedback && <div className="form-feedback ledger-feedback" role="alert">{shellFeedback}</div>}
          {active === 'Auditoría' ? <AuditPanel /> : active === 'Clientes' ? <CustomersPanel role={user.role} /> : active === 'Vista general' ? <>
          <div className="app-welcome"><div><p suppressHydrationWarning>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }).toUpperCase()}</p><h1>Todo en orden, {user.displayName.split(' ')[0]}.</h1><span>Tu operación está funcionando con normalidad.</span></div><select aria-label="Período" value={overviewPeriod} onChange={(event) => setOverviewPeriod(event.target.value as '7d' | '30d')}><option value="30d">Últimos 30 días</option><option value="7d">Últimos 7 días</option></select></div>
          <div className="app-kpis">
            <article className="kpi-balance"><div><small>SALDO DISPONIBLE · {primaryBalance?.currency ?? 'ARS'}</small><span>Calculado desde postings</span></div><strong>{money(primaryBalance?.available ?? data.balance, primaryBalance?.currency ?? 'ARS')}</strong><small className="ledger-caption">Contable {money(primaryBalance?.current ?? data.balance, primaryBalance?.currency ?? 'ARS')} · Reservado {money(primaryBalance?.held ?? 0, primaryBalance?.currency ?? 'ARS')}</small><div className="balance-actions">{canOperate && <button onClick={() => setTransferOpen(true)}>↗ Transferir</button>}<button onClick={() => setActive('Cuentas')}>◎ Ver ledger</button></div></article>
            <article><div className="kpi-title"><span>Volumen ARS · {overviewDays} días</span><i>↗</i></div><strong>{money(overviewSummary.processedArs)}</strong><small>{overviewSummary.transactionCount.toLocaleString('es-AR')} movimientos registrados en el período</small></article>
            <article><div className="kpi-title"><span>Tasa de aprobación · {overviewDays} días</span><i>✓</i></div><strong>{overviewSummary.approvalRate.toFixed(1)}%</strong><small>Calculada con estados persistidos</small><div className="ring" style={{'--ring': `${overviewSummary.approvalRate * 3.6}deg`} as React.CSSProperties}><span>{overviewSummary.approvalRate.toFixed(0)}%</span></div></article>
            <article><div className="kpi-title"><span>Cuentas activas</span><i>◉</i></div><strong>{data.activeAccounts.toLocaleString('es-AR')}</strong><small>Cuentas de producto persistidas para la organización</small></article>
          </div>
          <div className="app-lower-grid">
            <article className="app-table-card">
              <div className="card-head"><div><h2>Actividad reciente</h2><p>Movimientos de todos tus productos</p></div><button onClick={() => setActive('Movimientos')}>Ver todos →</button></div>
              <div className="app-table-head"><span>MOVIMIENTO</span><span>FECHA</span><span>MONTO</span><span>ESTADO</span></div>
              {overviewTransactions.length === 0 ? <div className="table-empty">No hay movimientos en los últimos {overviewDays} días.</div> : overviewTransactions.map((transaction) => <div className="app-table-row" key={transaction.id}><span className="movement"><i>{transaction.amount < 0 ? '↗' : '↙'}</i><b>{transaction.counterparty}<small>{transaction.description}</small></b></span><span>{new Date(transaction.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short' })}<small>{new Date(transaction.createdAt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</small></span><strong className={transaction.amount < 0 ? '' : 'positive'}>{transaction.amount > 0 ? '+' : ''}{money(transaction.amount, transaction.currency)}</strong><span className={`row-status ${transaction.status}`}><i />{statusLabel(transaction.status)}</span></div>)}
            </article>
            <aside className="risk-card"><div className="card-head"><div><h2>Control de riesgo</h2><p>Reservas persistidas del sandbox</p></div><span className="risk-live">● ACTIVO</span></div><div className="risk-score"><div><strong>{data.riskAlerts}</strong><span>reservas abiertas</span></div><div><strong>{data.journalCount}</strong><span>journals posteados</span></div></div>{data.holds.slice(0,1).map((hold)=><div className="risk-item" key={hold.id}><i className="coral-dot">!</i><span><strong>Fondos reservados</strong><small>{hold.counterparty} · {money(hold.amount,hold.currency)}</small></span><b>Revisar</b></div>)}<div className="risk-item"><i>✓</i><span><strong>Integridad del ledger</strong><small>Débitos y créditos validados en PostgreSQL</small></span><b className="normal">Activo</b></div><button className="risk-button" onClick={() => setActive('Riesgo')}>Abrir centro de riesgo →</button></aside>
          </div>
          </> : active === 'Seguridad' ? <SecurityPanel user={user} /> : active === 'Payments' ? <BookTransfersPanel accounts={data.accounts} role={user.role} onCashMovement={() => setPaymentOpen(true)} /> : active === 'Payouts' ? <PayoutsPanel accounts={data.accounts} actorRole={user.role} /> : active === 'Servicios' ? <BillersPanel accounts={data.accounts} actorRole={user.role} /> : active === 'Disputas' ? <DisputesPanel readOnly={!roleCan(user.role, 'disputes.write')} /> : active === 'Operaciones' ? <OperationsPanel readOnly={!roleCan(user.role, 'operations.write')} /> : active === 'Aprobaciones' ? <ApprovalsPanel actorRole={user.role} mfaEnabled={user.mfaEnabled} /> : active === 'Compliance' ? <CompliancePanel actorRole={user.role} mfaEnabled={user.mfaEnabled} currentUserId={user.userId} /> : active === 'Accesos' && canManageOrganization ? <AccessPanel actorRole={user.role as Extract<Role, 'owner' | 'admin'>} /> : <SecondaryConsoleView active={active} data={data} role={user.role} busy={busy} feedback={feedback} refreshKey={ledgerEpoch} onPayment={() => setPaymentOpen(true)} onHold={resolveReview} />}
        </div>
      </section>

      {transferOpen && <div className="drawer-backdrop" onMouseDown={() => setTransferOpen(false)}><aside className="transfer-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><small>SANDBOX</small><h2>Nueva transferencia</h2></div><button onClick={() => setTransferOpen(false)} aria-label="Cerrar">×</button></div><p>Simulá una transferencia. Las operaciones de alto monto pasan automáticamente por revisión de riesgo.</p><form onSubmit={createTransfer}><label>Destinatario<input name="counterparty" placeholder="Ej. Proveedor Andino" required minLength={2} /></label><label>Concepto<input name="description" placeholder="Ej. Pago de servicios" required minLength={2} /></label><div className="form-split"><label>Monto<input name="amount" type="number" min={transferCurrency==='CLP'?'1':'0.01'} max="10000000" step={transferCurrency==='CLP'?'1':'0.01'} placeholder="250000" required /></label><label>Moneda<select name="currency" value={transferCurrency} onChange={(event)=>setTransferCurrency(event.target.value)}><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>{feedback && <div className="form-feedback">{feedback}</div>}<button className="drawer-submit" disabled={busy}>{busy ? 'Procesando…' : 'Crear transferencia →'}</button></form><small className="drawer-note">Esta es una operación de sandbox. No mueve fondos reales.</small></aside></div>}
      {paymentOpen && <div className="drawer-backdrop" onMouseDown={() => setPaymentOpen(false)}><aside className="transfer-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><small>PAYMENT METHODS · SANDBOX</small><h2>Nuevo payment</h2></div><button onClick={() => setPaymentOpen(false)} aria-label="Cerrar">×</button></div><p>Registrá un ingreso o payout contra una cuenta. Cada operación genera postings y auditoría.</p><form onSubmit={createPayment}><label>Dirección<select value={paymentDirection} onChange={(event)=>setPaymentDirection(event.target.value as 'cash_in'|'cash_out')}><option value="cash_in">Cash-in · ingreso</option><option value="cash_out">Cash-out · payout</option></select></label><label>Cuenta<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar cuenta</option>{data.accounts.map((account)=><option key={account.id} value={account.id}>{account.accountReference} · {account.currency} · {money(account.balance,account.currency)}</option>)}</select></label><label>Contraparte<input name="counterparty" placeholder="Banco, sponsor o beneficiario" required minLength={2} /></label><label>Concepto<input name="description" placeholder="Liquidación, fondeo o payout" required minLength={2} /></label><label>Monto<input name="amount" type="number" min="0.01" max="10000000" step="0.01" required /></label>{feedback&&<div className="form-feedback">{feedback}</div>}<button className="drawer-submit" disabled={busy||data.accounts.length===0}>{busy?'Procesando…':'Procesar payment →'}</button></form><small className="drawer-note">Sandbox: no mueve fondos reales ni llama proveedores externos.</small></aside></div>}
    </main>
  );
}

function SecondaryConsoleView({ active, data, role, busy, feedback, refreshKey, onPayment, onHold }: {
  active: string; data: DashboardData; role: Role; busy: boolean; feedback: string; refreshKey: number;
  onPayment: () => void;
  onHold: (holdId: string, action: 'capture' | 'release') => void;
}) {
  const canOperate = roleCan(role, 'finance.write');

  if (active === 'Movimientos') return <TransfersPanel role={role} refreshKey={refreshKey} />;

  if (active === 'Payments') return <div className="module-view"><div className="module-view-head"><div><p>PAYMENT ORCHESTRATION</p><h1>Cash-in y cash-out</h1><span>Ingresos y payouts aplicados a cuentas concretas, listos para adaptadores regionales.</span></div>{canOperate && <button className="app-primary" onClick={onPayment}>+ Nuevo payment</button>}</div>{feedback&&<div className="form-feedback ledger-feedback">{feedback}</div>}<div className="module-metrics"><article><strong>{data.accounts.length}</strong><span>cuentas operables</span></article><article><strong>{data.transactions.filter((item)=>item.amount>0).length}</strong><span>ingresos recientes</span></article><article><strong>{data.transactions.filter((item)=>item.amount<0).length}</strong><span>egresos recientes</span></article></div><article className="module-list"><div className="card-head"><div><h2>Cuentas de producto</h2><p>Saldo derivado de postings por cuenta</p></div><b>LEDGER-BACKED</b></div>{data.accounts.length===0?<div><span className="movement"><i>◉</i><b>Sin cuentas<small>{canOperate ? 'Creá una cuenta en Cuentas para comenzar' : 'No hay cuentas disponibles para consultar'}</small></b></span><strong>Vacío</strong></div>:data.accounts.map((account)=><div key={account.id}><span className="movement"><i>◉</i><b>{account.accountReference}<small>{account.country} · {account.currency} · {account.status}</small></b></span><strong>{money(account.balance,account.currency)}</strong></div>)}</article></div>;

  if (active === 'Cuentas') return <AccountsPanel role={role} balances={data.balances} />;

  if (active === 'Riesgo') return <RiskPanel holds={data.holds} busy={busy} canManageRules={roleCan(role, 'risk.rules.manage')} canResolve={roleCan(role, 'risk.cases.resolve')} onHold={onHold} />;

  if (active === 'Conciliación') return <ReconciliationPanel readOnly={!canOperate} />;

  if (active === 'Tarjetas') return <CardsPanel initialCards={data.cards} accounts={data.accounts} role={role} />;

  if (active === 'Wallets') return <WalletsPanel role={role} />;

  if (active === 'Pagos AR') return <InstantPaymentsPanel role={role} accounts={data.accounts} />;

  if (active === 'Cobranzas') return <CollectionsPanel role={role} accounts={data.accounts} />;

  if (active === 'ECHEQ') return <EcheqsPanel role={role} accounts={data.accounts} />;

  if (active === 'Developers') return <DevelopersPanel journalCount={data.journalCount} />;

  if (active === 'Plataforma') return <PlatformPanel />;

  if (active === 'Soporte') return <SupportPanel readOnly={!roleCan(role, 'support.write')} />;

  if (active === 'Organización') return <OrganizationPanel canManage={roleCan(role, 'organization.manage')} />;

  return null;
}
