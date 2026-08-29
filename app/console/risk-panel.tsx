'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Rule = { id: string; familyId: string; version: number; deployment: 'champion' | 'challenger' | 'archived'; name: string; kind: string; operationType: string; scoreDelta: number; action: string; configuration: Record<string, unknown>; priority: number; status: string };
type Evaluation = { id: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[]; createdAt: string };
type RiskCase = { id: string; holdId: string | null; status: string; priority: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[]; createdAt: string };
type SystemPolicy = { id: string; name: string; action: string; status: string };
type Hold = { id: string; counterparty: string; description: string; amount: number; currency: string };
type RiskMetrics = { windowDays: number; totalEvaluations: number; approvals: number; reviews: number; declines: number; openCases: number; resolvedCases: number; approvedAfterReview: number; falsePositiveProxyRate: number | null };
type DecisionSummary = { approve: number; review: number; decline: number; averageScore: number };
type Simulation = { id: string; candidateRuleId: string; candidateName: string; candidateVersion: number; sampleCount: number; baselineSummary: DecisionSummary; candidateSummary: DecisionSummary; deltaSummary: { decisionsChanged: number; newlyReviewed: number; newlyDeclined: number; newlyApproved: number; averageScoreDelta: number }; createdAt: string };

function money(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(value);
}

export default function RiskPanel({ holds, busy: externalBusy, canManageRules, canResolve, onHold }: {
  holds: Hold[]; busy: boolean; canManageRules: boolean; canResolve: boolean; onHold: (id: string, action: 'capture' | 'release') => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]); const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [cases, setCases] = useState<RiskCase[]>([]); const [systemPolicies, setSystemPolicies] = useState<SystemPolicy[]>([]);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [metrics, setMetrics] = useState<RiskMetrics>({ windowDays: 30, totalEvaluations: 0, approvals: 0, reviews: 0, declines: 0, openCases: 0, resolvedCases: 0, approvedAfterReview: 0, falsePositiveProxyRate: null });
  const [kind, setKind] = useState('amount_threshold'); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const openCases = useMemo(() => cases.filter((item) => item.status === 'open'), [cases]);
  const linkedHolds = useMemo(() => new Set(cases.map((item) => item.holdId).filter(Boolean)), [cases]);
  const unlinkedHolds = holds.filter((hold) => !linkedHolds.has(hold.id));

  async function load() {
    const response = await authenticatedFetch('/api/v1/risk', { cache: 'no-store' });
    const result = await response.json() as { data?: { rules: Rule[]; evaluations: Evaluation[]; cases: RiskCase[]; systemPolicies: SystemPolicy[]; simulations: Simulation[]; metrics: RiskMetrics }; error?: { message?: string } | string };
    if (!response.ok) return setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar riesgo.');
    setRules(result.data?.rules ?? []); setEvaluations(result.data?.evaluations ?? []); setCases(result.data?.cases ?? []); setSystemPolicies(result.data?.systemPolicies ?? []);
    setSimulations(result.data?.simulations ?? []); if (result.data?.metrics) setMetrics(result.data.metrics);
  }

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, []);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setBusy(true); setFeedback(''); const form = new FormData(formElement);
    const configuration = kind === 'amount_threshold' ? { threshold: form.get('threshold'), currency: form.get('currency') }
      : kind === 'counterparty_match' ? { pattern: form.get('pattern') }
        : { count: Number(form.get('count')), windowMinutes: Number(form.get('windowMinutes')) };
    const baseRuleId = String(form.get('baseRuleId') ?? '');
    const endpoint = baseRuleId ? `/api/v1/risk/rules/${baseRuleId}/versions` : '/api/v1/risk/rules';
    const response = await authenticatedFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: form.get('name'), kind, operationType: form.get('operationType'), action: form.get('action'),
        scoreDelta: Number(form.get('scoreDelta')), priority: Number(form.get('priority')), configuration }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? baseRuleId ? 'Versión challenger creada. No afecta decisiones en vivo hasta simularla y promoverla.' : 'Política champion activada para la próxima evaluación.' : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear la regla.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function disableRule(id: string) {
    setBusy(true); const response = await authenticatedFetch(`/api/v1/risk/rules/${id}`, { method: 'DELETE' });
    setFeedback(response.ok ? 'Regla deshabilitada.' : 'No pudimos deshabilitar la regla.'); if (response.ok) await load(); setBusy(false);
  }

  async function promoteRule(id: string) {
    if (!window.confirm('La challenger reemplazará a la champion activa para esta familia. ¿Continuar?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/risk/rules/${id}/promote`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Versión promovida. La champion anterior quedó archivada y las nuevas evaluaciones ya usan esta política.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos promover la política.');
    if (response.ok) await load(); setBusy(false);
  }

  async function simulateRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    const samples = String(form.get('samples') ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [operationType, amount, currency, ...counterparty] = line.split(',').map((part) => part.trim());
      return { operationType, amount, currency, counterparty: counterparty.join(', ') };
    });
    const response = await authenticatedFetch('/api/v1/risk/simulations', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ candidateRuleId: form.get('candidateRuleId'), samples }) });
    const result = await response.json() as { simulation?: Simulation; error?: { message?: string } | string };
    setFeedback(response.ok && result.simulation ? `Simulación completa: ${result.simulation.deltaSummary.decisionsChanged} de ${result.simulation.sampleCount} decisiones cambiarían.`
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos ejecutar la simulación.');
    if (response.ok) await load(); setBusy(false);
  }

  async function resolveCase(id: string, resolution: 'approved' | 'declined') {
    setBusy(true); setFeedback(''); const response = await authenticatedFetch(`/api/v1/risk/cases/${id}/resolve`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ resolution, note: `Decisión ${resolution} desde consola sandbox.` }) });
    const result = await response.json() as { error?: { message?: string } | string; requiresApproval?: boolean; approval?: { status?: string } };
    setFeedback(response.ok ? result.requiresApproval && result.approval?.status === 'pending'
      ? 'Solicitud enviada a doble aprobación. El caso sigue abierto hasta que otro owner/admin con MFA decida.'
      : `Caso ${resolution === 'approved' ? 'aprobado' : 'rechazado'} y estado operativo sincronizado.`
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos resolver el caso.');
    if (response.ok) await load(); setBusy(false);
  }

  const championRules = rules.filter((rule) => rule.status === 'active' && rule.deployment === 'champion');
  const challengerRules = rules.filter((rule) => rule.status === 'active' && rule.deployment === 'challenger');

  return <div className="module-view risk-console">
    <div className="module-view-head"><div><p>RISK DECISION ENGINE</p><h1>Riesgo y fraude</h1><span>Políticas propias versionadas, simulación controlada, score explicable, casos y holds sincronizados.</span></div><span className="module-health"><i /> {openCases.length} casos abiertos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics risk-metrics"><article><strong>{systemPolicies.length + championRules.length}</strong><span>champions en vivo</span></article><article><strong>{metrics.totalEvaluations}</strong><span>evaluaciones · {metrics.windowDays} días</span></article><article><strong>{metrics.reviews + metrics.declines}</strong><span>revisión o rechazo · {metrics.windowDays} días</span></article><article><strong>{metrics.falsePositiveProxyRate === null ? '—' : `${metrics.falsePositiveProxyRate}%`}</strong><span>proxy de falsos positivos · {metrics.approvedAfterReview}/{metrics.resolvedCases} casos resueltos</span></article></div>
    <div className="integration-grid risk-grid">
      {canManageRules ? <article className="integration-card"><div className="card-head"><div><h2>Nueva política o versión</h2><p>Una nueva familia queda champion; una versión queda challenger</p></div><b>IMMUTABLE</b></div>
        <form className="integration-form risk-rule-form" onSubmit={createRule}><label>Familia<select name="baseRuleId" defaultValue=""><option value="">Nueva política champion</option>{championRules.map((rule) => <option key={rule.id} value={rule.id}>Nueva versión de {rule.name} · v{rule.version}</option>)}</select></label><div className="integration-fields"><label>Nombre<input name="name" placeholder="Monto sensible ARS" minLength={2} required /></label><label>Tipo<select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="amount_threshold">Monto</option><option value="velocity_count">Velocity</option><option value="counterparty_match">Contraparte</option></select></label></div>
          <div className="integration-fields"><label>Operación<select name="operationType"><option value="any">Todas</option><option value="transfer">Transferencia</option><option value="cash_out">Cash-out</option><option value="cash_in">Cash-in</option></select></label><label>Acción<select name="action"><option value="score">Sumar score</option><option value="review">Enviar a revisión</option><option value="decline">Rechazar</option></select></label></div>
          {kind === 'amount_threshold' && <div className="integration-fields"><label>Umbral<input name="threshold" inputMode="decimal" placeholder="750000.00" required /></label><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>}
          {kind === 'velocity_count' && <div className="integration-fields"><label>Cantidad<input name="count" type="number" min="2" max="1000" defaultValue="5" required /></label><label>Ventana (min)<input name="windowMinutes" type="number" min="1" max="10080" defaultValue="60" required /></label></div>}
          {kind === 'counterparty_match' && <label>Patrón de contraparte<input name="pattern" placeholder="casino" minLength={2} maxLength={80} required /></label>}
          <div className="integration-fields"><label>Score adicional<input name="scoreDelta" type="number" min="0" max="100" defaultValue="35" required /></label><label>Prioridad<input name="priority" type="number" min="1" max="1000" defaultValue="100" required /></label></div><button disabled={busy}>Guardar política</button>
        </form>
      </article> : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Política protegida</h2><p>Tu rol consulta reglas, pero no cambia decisiones globales</p></div><b>READ ONLY</b></div><p>La creación y desactivación de reglas está reservada a owner y admin. Los operadores pueden resolver casos; viewers sólo auditan.</p></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Registro de políticas</h2><p>Sistema + historial inmutable por familia</p></div><b>{systemPolicies.length + rules.length}</b></div><div className="integration-list compact-list">
        {systemPolicies.map((policy) => <div key={policy.id}><span><strong>{policy.name}</strong><small>{policy.id} · {policy.action}</small></span><b className="active">system</b></div>)}
        {rules.map((rule) => <div key={rule.id}><span><strong>{rule.name}</strong><small>v{rule.version} · {rule.kind} · {rule.operationType} · +{rule.scoreDelta} · {rule.action}</small></span><b className={rule.deployment}>{rule.deployment}</b>{canManageRules && rule.status === 'active' && <span className="policy-actions">{rule.deployment === 'challenger' && <button disabled={busy} onClick={() => void promoteRule(rule.id)}>Promover</button>}<button disabled={busy} onClick={() => void disableRule(rule.id)}>Archivar</button></span>}</div>)}
      </div></article>
    </div>
    <div className="integration-grid risk-grid">
      {canManageRules ? <article className="integration-card"><div className="card-head"><div><h2>Simular challenger</h2><p>Compara escenarios sin afectar decisiones en vivo</p></div><b>SHADOW</b></div><form className="integration-form risk-rule-form" onSubmit={simulateRule}>
        <label>Versión candidata<select name="candidateRuleId" required disabled={challengerRules.length === 0}><option value="">Seleccionar challenger</option>{challengerRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · v{rule.version}</option>)}</select></label>
        <label>Muestras<textarea name="samples" rows={6} required defaultValue={'transfer,250000,ARS,Proveedor habitual\ntransfer,850000,ARS,Proveedor nuevo\ncash_out,1200000,ARS,Comercio sensible'} /></label>
        <small>Una por línea: operación, monto, moneda, contraparte. Máximo 50. Las muestras no se persisten; sólo se guardan agregados.</small><button disabled={busy || challengerRules.length === 0}>Ejecutar simulación</button>
      </form></article> : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Simulación protegida</h2><p>Los resultados históricos permanecen disponibles para auditoría</p></div><b>READ ONLY</b></div><p>Owner y admin pueden ejecutar escenarios y promover challengers. La promoción nunca se realiza automáticamente.</p></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Simulaciones recientes</h2><p>Impacto agregado contra la champion vigente al ejecutar</p></div><b>{simulations.length}</b></div><div className="integration-list compact-list simulation-list">
        {simulations.length === 0 ? <div><span><strong>Sin simulaciones</strong><small>Creá una versión challenger para comparar decisiones.</small></span><b>—</b></div> : simulations.map((simulation) => <div key={simulation.id}><span><strong>{simulation.candidateName} · v{simulation.candidateVersion}</strong><small>{simulation.sampleCount} muestras · score medio {simulation.baselineSummary.averageScore} → {simulation.candidateSummary.averageScore}</small></span><b>{simulation.deltaSummary.decisionsChanged} cambios</b></div>)}
      </div></article>
    </div>
    <p className="risk-metric-note">El proxy de falsos positivos es la proporción de casos revisados que luego fueron aprobados. Es una señal operativa, no una etiqueta confirmada de fraude.</p>
    <article className="module-list hold-list"><div className="card-head"><div><h2>Cola de decisión</h2><p>Casos explicables vinculados a evaluaciones y reservas</p></div><b>{openCases.length} abiertos</b></div>
      {openCases.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin casos pendientes<small>Las evaluaciones aprobadas no generan trabajo manual</small></b></span><strong>Al día</strong></div> : openCases.map((riskCase) => <div key={riskCase.id}><span className="movement"><i>!</i><b>{riskCase.counterparty}<small>{money(riskCase.amount, riskCase.currency)} · score {riskCase.score} · {riskCase.reasons.join(', ') || 'política manual'}</small></b></span>{canResolve ? <span className="hold-actions"><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'declined')}>Rechazar</button><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'approved')}>Aprobar</button></span> : <strong>Pendiente</strong>}</div>)}
      {unlinkedHolds.map((hold) => <div key={hold.id}><span className="movement"><i>◇</i><b>{hold.counterparty}<small>Reserva anterior sin caso · {hold.description} · {money(hold.amount, hold.currency)}</small></b></span>{canResolve ? <span className="hold-actions"><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'release')}>Liberar</button><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'capture')}>Capturar</button></span> : <strong>Reservado</strong>}</div>)}
    </article>
    <article className="module-list"><div className="card-head"><div><h2>Evaluaciones recientes</h2><p>Score, decisión y razones persistidas</p></div><b>{evaluations.length}</b></div>{evaluations.slice(0, 20).map((evaluation) => <div key={evaluation.id}><span className="movement"><i>{evaluation.decision === 'approve' ? '✓' : '!'}</i><b>{evaluation.counterparty}<small>{money(evaluation.amount, evaluation.currency)} · {evaluation.reasons.join(', ') || 'baseline'}</small></b></span><strong>{evaluation.score} · {evaluation.decision}</strong></div>)}</article>
  </div>;
}
