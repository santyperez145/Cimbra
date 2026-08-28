'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import type { DashboardData } from '@/db/runtime';

const nav = [
  ['▦', 'Vista general'], ['↔', 'Movimientos'], ['◉', 'Cuentas'], ['▰', 'Tarjetas'],
  ['◇', 'Riesgo'], ['✓', 'Compliance'], ['⌁', 'Developers'],
];

function money(value: number, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(value);
}

function statusLabel(status: string) {
  return ({ settled: 'Liquidado', authorized: 'Autorizado', review: 'En revisión', pending: 'Pendiente' } as Record<string, string>)[status] ?? status;
}

export default function ConsoleClient({ data, user }: { data: DashboardData; user: { displayName: string; email: string } }) {
  const router = useRouter();
  const [active, setActive] = useState('Vista general');
  const [transferOpen, setTransferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/sandbox/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ counterparty: form.get('counterparty'), description: form.get('description'), amount: form.get('amount'), currency: form.get('currency') }),
    });
    const result = await response.json() as { error?: string; transaction?: { status: string } };
    if (!response.ok) setFeedback(result.error ?? 'No pudimos crear la transferencia.');
    else { setFeedback(result.transaction?.status === 'review' ? 'Transferencia creada y enviada a revisión.' : 'Transferencia liquidada en sandbox.'); router.refresh(); }
    setBusy(false);
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
        <header className="app-topbar"><div><small>CONSOLA /</small><strong>{active}</strong></div><div className="app-top-actions"><span className="live-pill"><i /> Todos los sistemas operativos</span><button aria-label="Notificaciones">♢</button><button className="app-primary" onClick={() => setTransferOpen(true)}>+ Nueva transferencia</button></div></header>
        <div className="app-content">
          {active === 'Vista general' ? <>
          <div className="app-welcome"><div><p>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</p><h1>Todo en orden, {user.displayName.split(' ')[0]}.</h1><span>Tu operación está funcionando con normalidad.</span></div><select aria-label="Período"><option>Últimos 30 días</option><option>Últimos 7 días</option></select></div>
          <div className="app-kpis">
            <article className="kpi-balance"><div><small>SALDO OPERATIVO</small><span>Actualizado ahora</span></div><strong>{money(data.balance)}</strong><div className="balance-actions"><button onClick={() => setTransferOpen(true)}>↗ Transferir</button><button>↓ Ingresar</button><button>•••</button></div></article>
            <article><div className="kpi-title"><span>Volumen procesado</span><i>↗</i></div><strong>{money(data.processedThisMonth)}</strong><small className="up">↗ 18,2% <em>vs. período anterior</em></small><div className="spark-bars">{[36,48,42,57,66,52,73,69,88,78,94,83].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></article>
            <article><div className="kpi-title"><span>Tasa de aprobación</span><i>✓</i></div><strong>{data.approvalRate.toFixed(1)}%</strong><small className="up">↗ 1,4% <em>vs. período anterior</em></small><div className="ring" style={{'--ring': `${data.approvalRate * 3.6}deg`} as React.CSSProperties}><span>{data.approvalRate.toFixed(0)}%</span></div></article>
            <article><div className="kpi-title"><span>Cuentas activas</span><i>◉</i></div><strong>{data.activeAccounts.toLocaleString('es-AR')}</strong><small className="up">↗ 204 <em>este mes</em></small><div className="avatars"><b>FS</b><b>MC</b><b>AN</b><b>+2k</b></div></article>
          </div>
          <div className="app-lower-grid">
            <article className="app-table-card">
              <div className="card-head"><div><h2>Actividad reciente</h2><p>Movimientos de todos tus productos</p></div><button onClick={() => setActive('Movimientos')}>Ver todos →</button></div>
              <div className="app-table-head"><span>MOVIMIENTO</span><span>FECHA</span><span>MONTO</span><span>ESTADO</span></div>
              {data.transactions.slice(0, 5).map((transaction) => <div className="app-table-row" key={transaction.id}><span className="movement"><i>{transaction.amount < 0 ? '↗' : '↙'}</i><b>{transaction.counterparty}<small>{transaction.description}</small></b></span><span>{new Date(transaction.createdAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short' })}<small>{new Date(transaction.createdAt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</small></span><strong className={transaction.amount < 0 ? '' : 'positive'}>{transaction.amount > 0 ? '+' : ''}{money(transaction.amount, transaction.currency)}</strong><span className={`row-status ${transaction.status}`}><i />{statusLabel(transaction.status)}</span></div>)}
            </article>
            <aside className="risk-card"><div className="card-head"><div><h2>Control de riesgo</h2><p>Monitoreo en tiempo real</p></div><span className="risk-live">● LIVE</span></div><div className="risk-score"><div><strong>{data.riskAlerts}</strong><span>alertas abiertas</span></div><div className="risk-donut"><span>98<small>/100</small></span></div></div><div className="risk-item"><i className="coral-dot">!</i><span><strong>Revisión de operación</strong><small>Marketplace Centro · hace 18 min</small></span><b>Alta</b></div><div className="risk-item"><i>✓</i><span><strong>Monitoreo transaccional</strong><small>2.847 operaciones analizadas</small></span><b className="normal">Normal</b></div><button className="risk-button" onClick={() => setActive('Riesgo')}>Abrir centro de riesgo →</button></aside>
          </div>
          </> : <SecondaryConsoleView active={active} data={data} onTransfer={() => setTransferOpen(true)} />}
        </div>
      </section>

      {transferOpen && <div className="drawer-backdrop" onMouseDown={() => setTransferOpen(false)}><aside className="transfer-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><small>SANDBOX</small><h2>Nueva transferencia</h2></div><button onClick={() => setTransferOpen(false)} aria-label="Cerrar">×</button></div><p>Simulá una transferencia. Las operaciones de alto monto pasan automáticamente por revisión de riesgo.</p><form onSubmit={createTransfer}><label>Destinatario<input name="counterparty" placeholder="Ej. Proveedor Andino" required minLength={2} /></label><label>Concepto<input name="description" placeholder="Ej. Pago de servicios" required minLength={2} /></label><div className="form-split"><label>Monto<input name="amount" type="number" min="1" max="10000000" step="0.01" placeholder="250000" required /></label><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option></select></label></div>{feedback && <div className="form-feedback">{feedback}</div>}<button className="drawer-submit" disabled={busy}>{busy ? 'Procesando…' : 'Crear transferencia →'}</button></form><small className="drawer-note">Esta es una operación de sandbox. No mueve fondos reales.</small></aside></div>}
    </main>
  );
}

function SecondaryConsoleView({ active, data, onTransfer }: { active: string; data: DashboardData; onTransfer: () => void }) {
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

  if (active === 'Movimientos') return <div className="module-view"><div className="module-view-head"><div><p>OPERACIONES</p><h1>Movimientos</h1><span>Consulta, filtra y exporta todas las operaciones.</span></div><button className="app-primary" onClick={onTransfer}>+ Nueva transferencia</button></div><article className="full-table"><div className="module-toolbar"><label>⌕ Buscar movimiento</label><div><button>Todos</button><button>Ingresos</button><button>Egresos</button><button>Exportar ↓</button></div></div><div className="app-table-head"><span>MOVIMIENTO</span><span>FECHA</span><span>MONTO</span><span>ESTADO</span></div>{data.transactions.map((transaction)=><div className="app-table-row" key={transaction.id}><span className="movement"><i>{transaction.amount < 0 ? '↗' : '↙'}</i><b>{transaction.counterparty}<small>{transaction.description}</small></b></span><span>{new Date(transaction.createdAt).toLocaleDateString('es-AR',{day:'2-digit',month:'short'})}<small>{new Date(transaction.createdAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</small></span><strong className={transaction.amount<0?'':'positive'}>{transaction.amount>0?'+':''}{money(transaction.amount,transaction.currency)}</strong><span className={`row-status ${transaction.status}`}><i />{statusLabel(transaction.status)}</span></div>)}</article></div>;

  if (active === 'Compliance') return <div className="module-view"><div className="module-view-head"><div><p>COMPLIANCE CENTER</p><h1>Expedientes y controles</h1><span>Evidencia KYC/KYB centralizada con trazabilidad completa.</span></div><span className="module-health"><i /> Operativo</span></div><div className="compliance-grid"><article className="compliance-score"><small>ESTADO DEL PROGRAMA</small><div><strong>92%</strong><span>Controles completos</span></div><ul><li><i /> Identidad y titularidad <b>Completo</b></li><li><i /> Estructura societaria <b>Completo</b></li><li><i className="pending" /> Evidencia de domicilio <b>Pendiente</b></li><li><i /> Screening PEP / sanciones <b>Completo</b></li></ul></article><article className="upload-card"><div className="module-icon">↑</div><h2>Agregar evidencia</h2><p>Subí documentación para el expediente. Se almacena de forma privada y queda registrada en auditoría.</p><form onSubmit={uploadDocument}><label>Seleccionar PDF, JPG o PNG<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><button disabled={uploading}>{uploading?'Subiendo…':'Subir documento →'}</button>{uploadState&&<div className="form-feedback">{uploadState}</div>}</form><small>Máximo 5 MB por archivo.</small></article><article className="review-queue"><div className="card-head"><div><h2>Cola de revisión</h2><p>Casos que requieren intervención</p></div><b>2 abiertos</b></div><div><span className="movement"><i>!</i><b>Marketplace Centro<small>Operación inusual · score 72</small></b></span><em>Alta</em></div><div><span className="movement"><i>◇</i><b>Nueva Empresa SA<small>Validar beneficiario final</small></b></span><em>Media</em></div></article></div></div>;

  const moduleCopy: Record<string, { title: string; eyebrow: string; description: string; metrics: [string,string][]; items: [string,string,string][] }> = {
    'Cuentas': { title:'Cuentas', eyebrow:'CORE & LEDGER', description:'Cuentas, saldos y movimientos sobre un ledger de doble partida.', metrics:[['2.481','cuentas activas'],['$ 84,2M','saldo administrado'],['100%','conciliado']], items:[['Finanzas Moda · Principal','ARS · CVU terminada en 3100','$ 18.904.420'],['Operaciones regionales','USD · Cuenta virtual','USD 284.910'],['Reserva de liquidación','ARS · Cuenta restringida','$ 4.520.000']] },
    'Tarjetas': { title:'Tarjetas', eyebrow:'ISSUING & PROCESSING', description:'Emisión, controles y autorizaciones en tiempo real.', metrics:[['1.284','tarjetas activas'],['96,8%','aprobación'],['18 ms','motor de reglas']], items:[['Sofía Martínez · •4821','Virtual · Débito','Activa'],['Federico Suárez · •1094','Física · Crédito','Activa'],['Compras Operaciones · •7732','Virtual · Corporativa','Pausada']] },
    'Riesgo': { title:'Centro de riesgo', eyebrow:'RISK ENGINE', description:'Reglas, señales y decisiones explicables en una sola vista.', metrics:[['2','alertas abiertas'],['98/100','salud del sistema'],['2.847','eventos analizados']], items:[['Operación inusual','Marketplace Centro · score 72','Revisar'],['Regla de velocidad','3 intentos en 60 segundos','Bloqueado'],['Nuevo dispositivo','Sofía Martínez · verificado','Resuelto']] },
    'Developers': { title:'Developers', eyebrow:'INTEGRACIÓN', description:'Credenciales, webhooks y logs para construir sobre Cimbra.', metrics:[['99,99%','uptime sandbox'],['18 ms','latencia p50'],['0','webhooks fallidos']], items:[['sk_test_••••••8FA2','API key · creada hoy','Rotar'],['https://api.tuapp.com/cimbra','Webhook · 200 OK','Activo'],['2026-08-01','Versión de API fijada','Actual']] },
  };
  const view = moduleCopy[active] ?? { title:active, eyebrow:'MÓDULO', description:'Configuración operativa del producto.', metrics:[['100%','operativo'],['0','incidentes'],['24/7','monitoreo']], items:[['Configuración principal','Sandbox Argentina','Activa']] };
  return <div className="module-view"><div className="module-view-head"><div><p>{view.eyebrow}</p><h1>{view.title}</h1><span>{view.description}</span></div><span className="module-health"><i /> Operativo</span></div><div className="module-metrics">{view.metrics.map(([value,label])=><article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div><article className="module-list"><div className="card-head"><div><h2>{active === 'Developers'?'Configuración':'Detalle operativo'}</h2><p>Datos del entorno sandbox</p></div><button>Configurar →</button></div>{view.items.map(([name,detail,value])=><div key={name}><span className="movement"><i>{active==='Tarjetas'?'▰':'◇'}</i><b>{name}<small>{detail}</small></b></span><strong>{value}</strong></div>)}</article></div>;
}
