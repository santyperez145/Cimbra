'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Rule = { id: string; name: string; kind: string; operationType: string; scoreDelta: number; action: string; configuration: Record<string, unknown>; priority: number; status: string };
type Evaluation = { id: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[]; createdAt: string };
type RiskCase = { id: string; holdId: string | null; status: string; priority: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[]; createdAt: string };
type SystemPolicy = { id: string; name: string; action: string; status: string };
type Hold = { id: string; counterparty: string; description: string; amount: number; currency: string };

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

export default function RiskPanel({ holds, busy: externalBusy, onHold }: {
  holds: Hold[]; busy: boolean; onHold: (id: string, action: 'capture' | 'release') => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]); const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [cases, setCases] = useState<RiskCase[]>([]); const [systemPolicies, setSystemPolicies] = useState<SystemPolicy[]>([]);
  const [kind, setKind] = useState('amount_threshold'); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const openCases = useMemo(() => cases.filter((item) => item.status === 'open'), [cases]);
  const linkedHolds = useMemo(() => new Set(cases.map((item) => item.holdId).filter(Boolean)), [cases]);
  const unlinkedHolds = holds.filter((hold) => !linkedHolds.has(hold.id));

  async function load() {
    const response = await fetch('/api/v1/risk', { cache: 'no-store' });
    const result = await response.json() as { data?: { rules: Rule[]; evaluations: Evaluation[]; cases: RiskCase[]; systemPolicies: SystemPolicy[] }; error?: { message?: string } | string };
    if (!response.ok) return setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar riesgo.');
    setRules(result.data?.rules ?? []); setEvaluations(result.data?.evaluations ?? []); setCases(result.data?.cases ?? []); setSystemPolicies(result.data?.systemPolicies ?? []);
  }

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, []);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setFeedback(''); const form = new FormData(formElement);
    const configuration = kind === 'amount_threshold' ? { threshold: form.get('threshold'), currency: form.get('currency') }
      : kind === 'counterparty_match' ? { pattern: form.get('pattern') }
        : { count: Number(form.get('count')), windowMinutes: Number(form.get('windowMinutes')) };
    const response = await fetch('/api/v1/risk/rules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: form.get('name'), kind, operationType: form.get('operationType'), action: form.get('action'),
        scoreDelta: Number(form.get('scoreDelta')), priority: Number(form.get('priority')), configuration }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Regla activada y disponible para la próxima evaluación.' : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear la regla.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function disableRule(id: string) {
    setBusy(true); const response = await fetch(`/api/v1/risk/rules/${id}`, { method: 'DELETE' });
    setFeedback(response.ok ? 'Regla deshabilitada.' : 'No pudimos deshabilitar la regla.'); if (response.ok) await load(); setBusy(false);
  }

  async function resolveCase(id: string, resolution: 'approved' | 'declined') {
    setBusy(true); setFeedback(''); const response = await fetch(`/api/v1/risk/cases/${id}/resolve`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ resolution, note: `Decisión ${resolution} desde consola sandbox.` }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? `Caso ${resolution === 'approved' ? 'aprobado' : 'rechazado'} y estado operativo sincronizado.` : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos resolver el caso.');
    if (response.ok) await load(); setBusy(false);
  }

  return <div className="module-view risk-console">
    <div className="module-view-head"><div><p>RISK DECISION ENGINE</p><h1>Riesgo y fraude</h1><span>Políticas propias, score explicable, casos y holds sincronizados.</span></div><span className="module-health"><i /> {openCases.length} casos abiertos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics"><article><strong>{systemPolicies.length + rules.filter((rule) => rule.status === 'active').length}</strong><span>políticas activas</span></article><article><strong>{evaluations.length}</strong><span>evaluaciones recientes</span></article><article><strong>{openCases.length}</strong><span>casos pendientes</span></article></div>
    <div className="integration-grid risk-grid">
      <article className="integration-card"><div className="card-head"><div><h2>Nueva regla</h2><p>Configurable por tenant y evaluada por prioridad</p></div><b>NATIVE</b></div>
        <form className="integration-form risk-rule-form" onSubmit={createRule}><div className="integration-fields"><label>Nombre<input name="name" placeholder="Monto sensible ARS" minLength={2} required /></label><label>Tipo<select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="amount_threshold">Monto</option><option value="velocity_count">Velocity</option><option value="counterparty_match">Contraparte</option></select></label></div>
          <div className="integration-fields"><label>Operación<select name="operationType"><option value="any">Todas</option><option value="transfer">Transferencia</option><option value="cash_out">Cash-out</option><option value="cash_in">Cash-in</option></select></label><label>Acción<select name="action"><option value="score">Sumar score</option><option value="review">Enviar a revisión</option><option value="decline">Rechazar</option></select></label></div>
          {kind === 'amount_threshold' && <div className="integration-fields"><label>Umbral<input name="threshold" inputMode="decimal" placeholder="750000.00" required /></label><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>}
          {kind === 'velocity_count' && <div className="integration-fields"><label>Cantidad<input name="count" type="number" min="2" max="1000" defaultValue="5" required /></label><label>Ventana (min)<input name="windowMinutes" type="number" min="1" max="10080" defaultValue="60" required /></label></div>}
          {kind === 'counterparty_match' && <label>Patrón de contraparte<input name="pattern" placeholder="casino" minLength={2} maxLength={80} required /></label>}
          <div className="integration-fields"><label>Score adicional<input name="scoreDelta" type="number" min="0" max="100" defaultValue="35" required /></label><label>Prioridad<input name="priority" type="number" min="1" max="1000" defaultValue="100" required /></label></div><button disabled={busy}>Activar regla</button>
        </form>
      </article>
      <article className="integration-card"><div className="card-head"><div><h2>Políticas activas</h2><p>Sistema inmutable + reglas del tenant</p></div><b>{systemPolicies.length + rules.length}</b></div><div className="integration-list compact-list">
        {systemPolicies.map((policy) => <div key={policy.id}><span><strong>{policy.name}</strong><small>{policy.id} · {policy.action}</small></span><b className="active">system</b></div>)}
        {rules.map((rule) => <div key={rule.id}><span><strong>{rule.name}</strong><small>{rule.kind} · {rule.operationType} · +{rule.scoreDelta} · {rule.action}</small></span><b className={rule.status}>{rule.status}</b>{rule.status === 'active' && <button disabled={busy} onClick={() => void disableRule(rule.id)}>Deshabilitar</button>}</div>)}
      </div></article>
    </div>
    <article className="module-list hold-list"><div className="card-head"><div><h2>Cola de decisión</h2><p>Casos explicables vinculados a evaluaciones y reservas</p></div><b>{openCases.length} abiertos</b></div>
      {openCases.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin casos pendientes<small>Las evaluaciones aprobadas no generan trabajo manual</small></b></span><strong>Al día</strong></div> : openCases.map((riskCase) => <div key={riskCase.id}><span className="movement"><i>!</i><b>{riskCase.counterparty}<small>{money(riskCase.amount, riskCase.currency)} · score {riskCase.score} · {riskCase.reasons.join(', ') || 'política manual'}</small></b></span><span className="hold-actions"><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'declined')}>Rechazar</button><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'approved')}>Aprobar</button></span></div>)}
      {unlinkedHolds.map((hold) => <div key={hold.id}><span className="movement"><i>◇</i><b>{hold.counterparty}<small>Reserva anterior sin caso · {hold.description} · {money(hold.amount, hold.currency)}</small></b></span><span className="hold-actions"><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'release')}>Liberar</button><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'capture')}>Capturar</button></span></div>)}
    </article>
    <article className="module-list"><div className="card-head"><div><h2>Evaluaciones recientes</h2><p>Score, decisión y razones persistidas</p></div><b>{evaluations.length}</b></div>{evaluations.slice(0, 20).map((evaluation) => <div key={evaluation.id}><span className="movement"><i>{evaluation.decision === 'approve' ? '✓' : '!'}</i><b>{evaluation.counterparty}<small>{money(evaluation.amount, evaluation.currency)} · {evaluation.reasons.join(', ') || 'baseline'}</small></b></span><strong>{evaluation.score} · {evaluation.decision}</strong></div>)}</article>
  </div>;
}
