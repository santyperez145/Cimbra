'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormEvent, useState, useSyncExternalStore } from 'react';
import type { DashboardData } from '@/db/runtime';
import DevelopersPanel from './developers-panel';
import PlatformPanel from './platform-panel';
import ReconciliationPanel from './reconciliation-panel';
import RiskPanel from './risk-panel';
import SecurityPanel from './security-panel';

const nav = [
  ['▦', 'Vista general'], ['↔', 'Movimientos'], ['⇄', 'Payments'], ['◉', 'Cuentas'], ['▰', 'Tarjetas'],
  ['◇', 'Riesgo'], ['≋', 'Conciliación'], ['✓', 'Compliance'], ['⌘', 'Plataforma'], ['⌁', 'Developers'], ['⌾', 'Seguridad'],
];

function money(value: number, currency = 'ARS') {
  const decimals = currency === 'CLP' ? 0 : 2;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function statusLabel(status: string) {
  return ({ settled: 'Liquidado', authorized: 'Autorizado', review: 'En revisión', pending: 'Pendiente', reversed: 'Revertido', cancelled: 'Cancelado' } as Record<string, string>)[status] ?? status;
}

export default function ConsoleClient({ data, user }: {
  data: DashboardData;
  user: { displayName: string; email: string; emailVerified: boolean; mfaEnabled: boolean; recoveryCodeCount: number };
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [active, setActive] = useState('Vista general');
  const [transferOpen, setTransferOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [transferCurrency, setTransferCurrency] = useState('ARS');
  const [paymentDirection, setPaymentDirection] = useState<'cash_in' | 'cash_out'>('cash_in');
  const primaryBalance = data.balances.find((balance) => balance.currency === 'ARS') ?? data.balances[0];

  if (!mounted) return <main className="app-shell" aria-busy="true" aria-label="Cargando consola" />;

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/v1/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ counterparty: form.get('counterparty'), description: form.get('description'), amount: form.get('amount'), currency: form.get('currency') }),
    });
    const result = await response.json() as { error?: string; transaction?: { status: string } };
    if (!response.ok) setFeedback(result.error ?? 'No pudimos crear la transferencia.');
    else { setFeedback(result.transaction?.status === 'review' ? 'Transferencia creada y enviada a revisión.' : 'Transferencia liquidada en sandbox.'); router.refresh(); }
    setBusy(false);
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const account = data.accounts.find((item) => item.id === form.get('accountId'));
    const response = await fetch('/api/v1/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ accountId: account?.id, direction: paymentDirection, counterparty: form.get('counterparty'),
        description: form.get('description'), amount: form.get('amount'), currency: account?.currency }),
    });
    const result = await response.json() as { error?: { message?: string } | string; payment?: { status: string } };
    const error = typeof result.error === 'string' ? result.error : result.error?.message;
    if (!response.ok) setFeedback(error ?? 'No pudimos procesar el payment.');
    else { setFeedback(result.payment?.status === 'review' ? 'Cash-out enviado a revisión.' : 'Payment contabilizado correctamente.'); setPaymentOpen(false); router.refresh(); }
    setBusy(false);
  }

  async function reverseTransaction(transactionId: string) {
    setBusy(true); setFeedback('');
    const response = await fetch(`/api/v1/transfers/${transactionId}/reverse`, {
      method: 'POST', headers: { 'Idempotency-Key': `reverse-${transactionId}` },
    });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Transferencia revertida con un asiento compensatorio.' : result.error ?? 'No pudimos revertir la transferencia.');
    setBusy(false); router.refresh();
  }

  async function resolveReview(holdId: string, action: 'capture' | 'release') {
    setBusy(true); setFeedback('');
    const response = await fetch(`/api/v1/holds/${holdId}/${action}`, {
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
          {nav.map(([icon, label]) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)}><i>{icon}</i>{label}</button>)}
        </nav>
        <div className="app-help"><strong>Centro de ayuda</strong><span>Estamos para acompañarte</span></div>
        <button className="app-user" onClick={signOut} title="Cerrar sesión"><b>{user.displayName.slice(0, 2).toUpperCase()}</b><span><strong>{user.displayName}</strong><small>{user.email}</small></span><i>↗</i></button>
      </aside>

      <section className="app-main">
        <header className="app-topbar"><div><small>CONSOLA /</small><strong>{active}</strong></div><div className="app-top-actions"><span className="live-pill"><i /> Base y ledger operativos</span><button className="app-primary" onClick={() => setTransferOpen(true)}>+ Nueva transferencia</button></div></header>
        <div className="app-content">
          {active === 'Vista general' ? <>
          <div className="app-welcome"><div><p suppressHydrationWarning>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }).toUpperCase()}</p><h1>Todo en orden, {user.displayName.split(' ')[0]}.</h1><span>Tu operación está funcionando con normalidad.</span></div><select aria-label="Período"><option>Últimos 30 días</option><option>Últimos 7 días</option></select></div>
          <div className="app-kpis">
            <article className="kpi-balance"><div><small>SALDO DISPONIBLE · {primaryBalance?.currency ?? 'ARS'}</small><span>Calculado desde postings</span></div><strong>{money(primaryBalance?.available ?? data.balance, primaryBalance?.currency ?? 'ARS')}</strong><small className="ledger-caption">Contable {money(primaryBalance?.current ?? data.balance, primaryBalance?.currency ?? 'ARS')} · Reservado {money(primaryBalance?.held ?? 0, primaryBalance?.currency ?? 'ARS')}</small><div className="balance-actions"><button onClick={() => setTransferOpen(true)}>↗ Transferir</button><button onClick={() => setActive('Cuentas')}>◎ Ver ledger</button></div></article>
            <article><div className="kpi-title"><span>Volumen ARS del mes</span><i>↗</i></div><strong>{money(data.processedThisMonth)}</strong><small>{data.transactionCount.toLocaleString('es-AR')} movimientos registrados en el período</small></article>
            <article><div className="kpi-title"><span>Tasa de aprobación del mes</span><i>✓</i></div><strong>{data.approvalRate.toFixed(1)}%</strong><small>Calculada con estados persistidos</small><div className="ring" style={{'--ring': `${data.approvalRate * 3.6}deg`} as React.CSSProperties}><span>{data.approvalRate.toFixed(0)}%</span></div></article>
            <article><div className="kpi-title"><span>Cuentas activas</span><i>◉</i></div><strong>{data.activeAccounts.toLocaleString('es-AR')}</strong><small>Cuentas de producto persistidas para la organización</small></article>
          </div>
          <div className="app-lower-grid">
            <article className="app-table-card">
              <div className="card-head"><div><h2>Actividad reciente</h2><p>Movimientos de todos tus productos</p></div><button onClick={() => setActive('Movimientos')}>Ver todos →</button></div>
              <div className="app-table-head"><span>MOVIMIENTO</span><span>FECHA</span><span>MONTO</span><span>ESTADO</span></div>
              {data.transactions.slice(0, 5).map((transaction) => <div className="app-table-row" key={transaction.id}><span className="movement"><i>{transaction.amount < 0 ? '↗' : '↙'}</i><b>{transaction.counterparty}<small>{transaction.description}</small></b></span><span>{new Date(transaction.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short' })}<small>{new Date(transaction.createdAt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</small></span><strong className={transaction.amount < 0 ? '' : 'positive'}>{transaction.amount > 0 ? '+' : ''}{money(transaction.amount, transaction.currency)}</strong><span className={`row-status ${transaction.status}`}><i />{statusLabel(transaction.status)}</span></div>)}
            </article>
            <aside className="risk-card"><div className="card-head"><div><h2>Control de riesgo</h2><p>Reservas persistidas del sandbox</p></div><span className="risk-live">● ACTIVO</span></div><div className="risk-score"><div><strong>{data.riskAlerts}</strong><span>reservas abiertas</span></div><div><strong>{data.journalCount}</strong><span>journals posteados</span></div></div>{data.holds.slice(0,1).map((hold)=><div className="risk-item" key={hold.id}><i className="coral-dot">!</i><span><strong>Fondos reservados</strong><small>{hold.counterparty} · {money(hold.amount,hold.currency)}</small></span><b>Revisar</b></div>)}<div className="risk-item"><i>✓</i><span><strong>Integridad del ledger</strong><small>Débitos y créditos validados en PostgreSQL</small></span><b className="normal">Activo</b></div><button className="risk-button" onClick={() => setActive('Riesgo')}>Abrir centro de riesgo →</button></aside>
          </div>
          </> : active === 'Seguridad' ? <SecurityPanel user={user} /> : <SecondaryConsoleView active={active} data={data} busy={busy} feedback={feedback} onTransfer={() => setTransferOpen(true)} onPayment={() => setPaymentOpen(true)} onReverse={reverseTransaction} onHold={resolveReview} />}
        </div>
      </section>

      {transferOpen && <div className="drawer-backdrop" onMouseDown={() => setTransferOpen(false)}><aside className="transfer-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><small>SANDBOX</small><h2>Nueva transferencia</h2></div><button onClick={() => setTransferOpen(false)} aria-label="Cerrar">×</button></div><p>Simulá una transferencia. Las operaciones de alto monto pasan automáticamente por revisión de riesgo.</p><form onSubmit={createTransfer}><label>Destinatario<input name="counterparty" placeholder="Ej. Proveedor Andino" required minLength={2} /></label><label>Concepto<input name="description" placeholder="Ej. Pago de servicios" required minLength={2} /></label><div className="form-split"><label>Monto<input name="amount" type="number" min={transferCurrency==='CLP'?'1':'0.01'} max="10000000" step={transferCurrency==='CLP'?'1':'0.01'} placeholder="250000" required /></label><label>Moneda<select name="currency" value={transferCurrency} onChange={(event)=>setTransferCurrency(event.target.value)}><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>{feedback && <div className="form-feedback">{feedback}</div>}<button className="drawer-submit" disabled={busy}>{busy ? 'Procesando…' : 'Crear transferencia →'}</button></form><small className="drawer-note">Esta es una operación de sandbox. No mueve fondos reales.</small></aside></div>}
      {paymentOpen && <div className="drawer-backdrop" onMouseDown={() => setPaymentOpen(false)}><aside className="transfer-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><small>PAYMENT METHODS · SANDBOX</small><h2>Nuevo payment</h2></div><button onClick={() => setPaymentOpen(false)} aria-label="Cerrar">×</button></div><p>Registrá un ingreso o payout contra una cuenta. Cada operación genera postings y auditoría.</p><form onSubmit={createPayment}><label>Dirección<select value={paymentDirection} onChange={(event)=>setPaymentDirection(event.target.value as 'cash_in'|'cash_out')}><option value="cash_in">Cash-in · ingreso</option><option value="cash_out">Cash-out · payout</option></select></label><label>Cuenta<select name="accountId" required defaultValue=""><option value="" disabled>Seleccionar cuenta</option>{data.accounts.map((account)=><option key={account.id} value={account.id}>{account.accountReference} · {account.currency} · {money(account.balance,account.currency)}</option>)}</select></label><label>Contraparte<input name="counterparty" placeholder="Banco, sponsor o beneficiario" required minLength={2} /></label><label>Concepto<input name="description" placeholder="Liquidación, fondeo o payout" required minLength={2} /></label><label>Monto<input name="amount" type="number" min="0.01" max="10000000" step="0.01" required /></label>{feedback&&<div className="form-feedback">{feedback}</div>}<button className="drawer-submit" disabled={busy||data.accounts.length===0}>{busy?'Procesando…':'Procesar payment →'}</button></form><small className="drawer-note">Sandbox: no mueve fondos reales ni llama proveedores externos.</small></aside></div>}
    </main>
  );
}

function SecondaryConsoleView({ active, data, busy, feedback, onTransfer, onPayment, onReverse, onHold }: {
  active: string; data: DashboardData; busy: boolean; feedback: string; onTransfer: () => void;
  onPayment: () => void;
  onReverse: (transactionId: string) => void; onHold: (holdId: string, action: 'capture' | 'release') => void;
}) {
  const [uploadState, setUploadState] = useState('');
  const [uploading, setUploading] = useState(false);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setUploading(true); setUploadState('');
    const response = await fetch('/api/compliance/documents', { method: 'POST', body: new FormData(event.currentTarget) });
    const result = await response.json() as { error?: string; document?: { fileName: string } };
    setUploadState(response.ok ? `${result.document?.fileName ?? 'Documento'} recibido y listo para revisión.` : result.error ?? 'No pudimos subir el documento.');
    if (response.ok) event.currentTarget.reset();
    setUploading(false);
  }

  if (active === 'Movimientos') return <div className="module-view"><div className="module-view-head"><div><p>OPERACIONES</p><h1>Movimientos</h1><span>Operaciones monetarias respaldadas por asientos inmutables.</span></div><button className="app-primary" onClick={onTransfer}>+ Nueva transferencia</button></div>{feedback&&<div className="form-feedback ledger-feedback">{feedback}</div>}<article className="full-table"><div className="module-toolbar"><label>⌕ Buscar movimiento</label><div><button>Todos</button><button>Ingresos</button><button>Egresos</button><button>Exportar ↓</button></div></div><div className="app-table-head"><span>MOVIMIENTO</span><span>FECHA</span><span>MONTO</span><span>ESTADO</span></div>{data.transactions.map((transaction)=><div className="app-table-row" key={transaction.id}><span className="movement"><i>{transaction.amount < 0 ? '↗' : '↙'}</i><b>{transaction.counterparty}<small>{transaction.description}</small></b></span><span>{new Date(transaction.createdAt).toLocaleDateString('es-AR',{day:'2-digit',month:'short'})}<small>{new Date(transaction.createdAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</small></span><strong className={transaction.amount<0?'':'positive'}>{transaction.amount>0?'+':''}{money(transaction.amount,transaction.currency)}</strong><span className={`row-status ${transaction.status}`}><i />{statusLabel(transaction.status)}{transaction.amount<0&&transaction.status==='settled'&&!transaction.reversalOf&&<button className="ledger-row-action" disabled={busy} onClick={()=>onReverse(transaction.id)}>Revertir</button>}</span></div>)}</article></div>;

  if (active === 'Payments') return <div className="module-view"><div className="module-view-head"><div><p>PAYMENT ORCHESTRATION</p><h1>Cash-in y cash-out</h1><span>Ingresos y payouts aplicados a cuentas concretas, listos para adaptadores regionales.</span></div><button className="app-primary" onClick={onPayment}>+ Nuevo payment</button></div>{feedback&&<div className="form-feedback ledger-feedback">{feedback}</div>}<div className="module-metrics"><article><strong>{data.accounts.length}</strong><span>cuentas operables</span></article><article><strong>{data.transactions.filter((item)=>item.amount>0).length}</strong><span>ingresos recientes</span></article><article><strong>{data.transactions.filter((item)=>item.amount<0).length}</strong><span>egresos recientes</span></article></div><article className="module-list"><div className="card-head"><div><h2>Cuentas de producto</h2><p>Saldo derivado de postings por cuenta</p></div><b>LEDGER-BACKED</b></div>{data.accounts.length===0?<div><span className="movement"><i>◉</i><b>Sin cuentas<small>Creá una cuenta mediante API para comenzar</small></b></span><strong>Vacío</strong></div>:data.accounts.map((account)=><div key={account.id}><span className="movement"><i>◉</i><b>{account.accountReference}<small>{account.country} · {account.currency} · {account.status}</small></b></span><strong>{money(account.balance,account.currency)}</strong></div>)}</article></div>;

  if (active === 'Cuentas') return <div className="module-view"><div className="module-view-head"><div><p>CORE & LEDGER</p><h1>Balances por moneda</h1><span>Saldo contable menos reservas activas. Ninguna moneda se mezcla con otra.</span></div><span className="module-health"><i /> Balanceado</span></div><div className="module-metrics ledger-balances">{data.balances.map((balance)=><article key={balance.currency}><small>{balance.currency}</small><strong>{money(balance.available,balance.currency)}</strong><span>Contable {money(balance.current,balance.currency)} · Reservado {money(balance.held,balance.currency)}</span></article>)}</div><article className="module-list"><div className="card-head"><div><h2>Reglas del núcleo</h2><p>Garantías activas en PostgreSQL</p></div><b>DOUBLE ENTRY</b></div><div><span className="movement"><i>＝</i><b>Partida doble<small>Cada journal exige débitos iguales a créditos</small></b></span><strong>Obligatorio</strong></div><div><span className="movement"><i>⌁</i><b>Inmutabilidad<small>Las correcciones se realizan mediante reversas</small></b></span><strong>Activo</strong></div><div><span className="movement"><i>¤</i><b>Unidades mínimas<small>BIGINT por moneda, sin punto flotante</small></b></span><strong>Activo</strong></div></article></div>;

  if (active === 'Riesgo') return <RiskPanel holds={data.holds} busy={busy} onHold={onHold} />;

  if (active === 'Conciliación') return <ReconciliationPanel />;

  if (active === 'Compliance') return <div className="module-view"><div className="module-view-head"><div><p>COMPLIANCE CENTER</p><h1>Evidencia documental</h1><span>Archivos privados con metadata y auditoría persistidas.</span></div><span className="module-health"><i /> {data.documents.length} documentos</span></div><div className="compliance-grid"><article className="upload-card"><div className="module-icon">↑</div><h2>Agregar evidencia</h2><p>Subí documentación para el expediente. Se almacena de forma privada y queda registrada en auditoría.</p><form onSubmit={uploadDocument}><label>Seleccionar PDF, JPG o PNG<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><button disabled={uploading}>{uploading?'Subiendo…':'Subir documento →'}</button>{uploadState&&<div className="form-feedback">{uploadState}</div>}</form><small>Máximo 5 MB por archivo.</small></article><article className="review-queue"><div className="card-head"><div><h2>Documentos recibidos</h2><p>Metadata del almacenamiento privado</p></div><b>{data.documents.length} registrados</b></div>{data.documents.length===0?<div><span className="movement"><i>◇</i><b>Sin documentos<small>Subí la primera evidencia para verla acá</small></b></span><em>Vacío</em></div>:data.documents.map((document)=><div key={document.id}><span className="movement"><i>✓</i><b>{document.fileName}<small>{Math.ceil(document.size/1024)} KB · {new Date(document.createdAt).toLocaleDateString('es-AR')}</small></b></span><em>{document.status}</em></div>)}</article></div></div>;

  if (active === 'Tarjetas') return <div className="module-view"><div className="module-view-head"><div><p>ISSUING SANDBOX</p><h1>Tarjetas emitidas</h1><span>Instrumentos de prueba vinculados a cuentas persistidas.</span></div><span className="module-health"><i /> {data.cards.filter((card)=>card.status==='active').length} activas</span></div><div className="module-metrics"><article><strong>{data.cards.length}</strong><span>tarjetas registradas</span></article><article><strong>{data.cards.filter((card)=>card.format==='virtual').length}</strong><span>virtuales</span></article><article><strong>{data.cards.filter((card)=>card.format==='physical').length}</strong><span>físicas</span></article></div><article className="module-list"><div className="card-head"><div><h2>Inventario sandbox</h2><p>No representa tarjetas emitidas en redes reales</p></div></div>{data.cards.length===0?<div><span className="movement"><i>▰</i><b>Sin tarjetas<small>Crealas mediante POST /api/sandbox/cards</small></b></span><strong>Vacío</strong></div>:data.cards.map((card)=><div key={card.id}><span className="movement"><i>▰</i><b>•••• {card.last4}<small>{card.format} · {card.product}</small></b></span><strong>{statusLabel(card.status)}</strong></div>)}</article></div>;

  if (active === 'Developers') return <DevelopersPanel journalCount={data.journalCount} />;

  if (active === 'Plataforma') return <PlatformPanel />;

  return null;
}
