'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Rule = { id: string; familyId: string; version: number; deployment: 'champion' | 'challenger' | 'archived'; name: string; kind: string; operationType: string; scoreDelta: number; action: string; configuration: Record<string, unknown>; priority: number; status: string };
type RiskOutcome = { id: string; label: 'legitimate' | 'fraud'; fraudType: string | null; lossAmountMinor: string; currency: string; note: string; createdAt: string };
type Evaluation = { id: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[];
  matchedListEntryIds: string[]; signals: { deviceReferencePresent: boolean; identityReferencePresent: boolean; deviceTrust?: string; identityVerified?: boolean; countryMismatch?: boolean };
  decisionLatencyMs: number | null; outcome: RiskOutcome | null; createdAt: string };
type StepUpChallenge = { id: string; evaluationId: string; method: 'otp'; delivery: 'client_managed'; status: 'pending' | 'verified' | 'failed' | 'expired' | 'cancelled';
  attemptCount: number; remainingAttempts: number; maxAttempts: number; expiresAt: string; verifiedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string };
type RiskListEntry = { id: string; subjectType: 'counterparty' | 'device' | 'identity'; subjectPreview: string; category: 'allow' | 'watch' | 'block'; reason: string; status: 'active' | 'disabled'; expiresAt: string | null; createdAt: string };
type RiskCase = { id: string; holdId: string | null; status: string; priority: string; counterparty: string; amount: number; currency: string; score: number; decision: string; reasons: string[]; createdAt: string };
type SystemPolicy = { id: string; name: string; action: string; status: string };
type Hold = { id: string; counterparty: string; description: string; amount: number; currency: string };
type RiskMetrics = { windowDays: number; totalEvaluations: number; approvals: number; reviews: number; declines: number; openCases: number; resolvedCases: number; approvedAfterReview: number; falsePositiveProxyRate: number | null;
  confirmed: { total: number; truePositives: number; falsePositives: number; trueNegatives: number; falseNegatives: number; precision: number | null; recall: number | null; falsePositiveRate: number | null; losses: Array<{ currency: string; amount: number; count: number }> };
  stepUp: { total: number; pending: number; verified: number; unsuccessful: number; verificationRate: number | null };
  decisionSlo: { targetMs: number; samples: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; complianceRate: number | null } };
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
  const [simulations, setSimulations] = useState<Simulation[]>([]); const [listEntries, setListEntries] = useState<RiskListEntry[]>([]);
  const [stepUpChallenges, setStepUpChallenges] = useState<StepUpChallenge[]>([]); const [stepUpSecret, setStepUpSecret] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RiskMetrics>({ windowDays: 30, totalEvaluations: 0, approvals: 0, reviews: 0, declines: 0, openCases: 0, resolvedCases: 0, approvedAfterReview: 0, falsePositiveProxyRate: null,
    confirmed: { total: 0, truePositives: 0, falsePositives: 0, trueNegatives: 0, falseNegatives: 0, precision: null, recall: null, falsePositiveRate: null, losses: [] },
    stepUp: { total: 0, pending: 0, verified: 0, unsuccessful: 0, verificationRate: null },
    decisionSlo: { targetMs: 250, samples: 0, p50Ms: null, p95Ms: null, p99Ms: null, complianceRate: null } });
  const [kind, setKind] = useState('amount_threshold'); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const [outcomeLabel, setOutcomeLabel] = useState<'legitimate' | 'fraud'>('legitimate');
  const openCases = useMemo(() => cases.filter((item) => item.status === 'open'), [cases]);
  const reviewEvaluations = useMemo(() => evaluations.filter((item) => item.decision === 'review'), [evaluations]);
  const pendingStepUps = useMemo(() => stepUpChallenges.filter((item) => item.status === 'pending'), [stepUpChallenges]);
  const linkedHolds = useMemo(() => new Set(cases.map((item) => item.holdId).filter(Boolean)), [cases]);
  const unlinkedHolds = holds.filter((hold) => !linkedHolds.has(hold.id));

  async function load() {
    const response = await authenticatedFetch('/api/v1/risk', { cache: 'no-store' });
    const result = await response.json() as { data?: { rules: Rule[]; evaluations: Evaluation[]; cases: RiskCase[]; systemPolicies: SystemPolicy[]; simulations: Simulation[]; listEntries: RiskListEntry[]; stepUpChallenges: StepUpChallenge[]; metrics: RiskMetrics }; error?: { message?: string } | string };
    if (!response.ok) return setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar riesgo.');
    setRules(result.data?.rules ?? []); setEvaluations(result.data?.evaluations ?? []); setCases(result.data?.cases ?? []); setSystemPolicies(result.data?.systemPolicies ?? []);
    setSimulations(result.data?.simulations ?? []); setListEntries(result.data?.listEntries ?? []); setStepUpChallenges(result.data?.stepUpChallenges ?? []); if (result.data?.metrics) setMetrics(result.data.metrics);
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

  async function createListEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/risk/lists', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ subjectType: form.get('subjectType'), subjectValue: form.get('subjectValue'), category: form.get('category'),
        reason: form.get('reason'), expiresAt: form.get('expiresAt') || undefined }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Entrada activa. El identificador original fue transformado antes de persistirse.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear la entrada.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function disableListEntry(id: string) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/v1/risk/lists/${id}`, { method: 'DELETE' });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? 'Entrada deshabilitada; el historial permanece auditable.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos deshabilitar la entrada.');
    if (response.ok) await load(); setBusy(false);
  }

  async function reportOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback('');
    const evaluation = evaluations.find((item) => item.id === form.get('evaluationId'));
    if (!evaluation) { setFeedback('Seleccioná una evaluación.'); setBusy(false); return; }
    const response = await authenticatedFetch(`/api/v1/risk/evaluations/${evaluation.id}/outcomes`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ label: outcomeLabel, fraudType: outcomeLabel === 'fraud' ? form.get('fraudType') : undefined,
        lossAmount: outcomeLabel === 'fraud' ? form.get('lossAmount') || '0' : undefined,
        currency: outcomeLabel === 'fraud' ? form.get('currency') : undefined, note: form.get('note'),
        supersedesOutcomeId: evaluation.outcome?.id }) });
    const result = await response.json() as { error?: { message?: string } | string };
    setFeedback(response.ok ? evaluation.outcome ? 'Corrección registrada como nueva revisión; el resultado anterior quedó preservado.' : 'Resultado confirmado y métricas actualizadas.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos registrar el resultado.');
    if (response.ok) { formElement.reset(); setOutcomeLabel('legitimate'); await load(); } setBusy(false);
  }

  async function createStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback(''); setStepUpSecret(null);
    const evaluationId = String(form.get('evaluationId') ?? '');
    const response = await authenticatedFetch(`/api/v1/risk/evaluations/${evaluationId}/step-up-challenges`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ method: 'otp', delivery: 'client_managed', expiresInSeconds: Number(form.get('expiresInSeconds')),
        maxAttempts: Number(form.get('maxAttempts')) }) });
    const result = await response.json() as { credential?: string | null; challenge?: StepUpChallenge; error?: { message?: string } | string };
    setFeedback(response.ok ? 'Challenge creado. Entregá el código por un canal aprobado; Cimbra no lo vuelve a mostrar en lecturas.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos crear el challenge.');
    if (response.ok) { setStepUpSecret(result.credential ?? null); formElement.reset(); await load(); } setBusy(false);
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback('');
    const challengeId = String(form.get('challengeId') ?? '');
    const challenge = stepUpChallenges.find((item) => item.id === challengeId);
    if (!challenge) { setFeedback('Seleccioná un challenge pendiente.'); setBusy(false); return; }
    const response = await authenticatedFetch(`/api/v1/risk/evaluations/${challenge.evaluationId}/step-up-challenges/${challenge.id}/verify`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ credential: form.get('credential') }) });
    const result = await response.json() as { verified?: boolean; challenge?: StepUpChallenge; attempt?: { result?: string }; error?: { message?: string } | string };
    setFeedback(response.ok ? result.verified ? 'Identidad reforzada verificada; el resultado quedó como evidencia del caso, sin bypass operativo.'
      : result.attempt?.result === 'mismatch' ? `Código incorrecto. Quedan ${result.challenge?.remainingAttempts ?? 0} intentos.`
        : 'El challenge ya no admite verificación.'
      : typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos verificar el challenge.');
    if (response.ok) { formElement.reset(); setStepUpSecret(null); await load(); } setBusy(false);
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
  const activeListEntries = listEntries.filter((entry) => entry.status === 'active');

  return <div className="module-view risk-console">
    <div className="module-view-head"><div><p>RISK DECISION ENGINE</p><h1>Riesgo y fraude</h1><span>Políticas versionadas, señales protegidas, step-up OTP, SLO medido, resultados confirmados, casos y holds sincronizados.</span></div><span className="module-health"><i /> {openCases.length} casos abiertos</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {stepUpSecret && <div className="secret-reveal step-up-secret"><div><strong>Credencial OTP client-managed</strong><span>Entregala por tu canal aprobado. No aparece en listas, eventos ni auditoría.</span></div><code>{stepUpSecret}</code><button type="button" onClick={() => setStepUpSecret(null)}>Ocultar</button></div>}
    <div className="module-metrics risk-metrics"><article><strong>{systemPolicies.length + championRules.length}</strong><span>champions en vivo</span></article><article><strong>{metrics.totalEvaluations}</strong><span>evaluaciones · {metrics.windowDays} días</span></article><article><strong>{metrics.decisionSlo.p95Ms === null ? '—' : `${metrics.decisionSlo.p95Ms} ms`}</strong><span>p95 de decisión · objetivo {metrics.decisionSlo.targetMs} ms</span></article><article><strong>{metrics.stepUp.verified}</strong><span>step-ups verificados · {metrics.stepUp.pending} pendientes</span></article></div>
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
    <div className="integration-grid risk-grid">
      {canManageRules ? <article className="integration-card"><div className="card-head"><div><h2>Lista de decisión</h2><p>Allow, watch o block para contraparte, dispositivo e identidad</p></div><b>HASHED</b></div>
        <form className="integration-form risk-rule-form" onSubmit={createListEntry}><div className="integration-fields"><label>Sujeto<select name="subjectType"><option value="counterparty">Contraparte</option><option value="device">Dispositivo</option><option value="identity">Identidad</option></select></label><label>Decisión<select name="category"><option value="watch">Observar</option><option value="block">Bloquear</option><option value="allow">Permitir señal</option></select></label></div>
          <label>Referencia<input name="subjectValue" minLength={2} maxLength={160} autoComplete="off" placeholder="ID interno, alias o referencia" required /></label>
          <label>Motivo<input name="reason" minLength={3} maxLength={240} placeholder="Origen y criterio operativo" required /></label>
          <label>Vencimiento opcional<input name="expiresAt" type="datetime-local" /></label>
          <small>La referencia se normaliza y hashea con aislamiento por organización. Allow reduce score, pero nunca fuerza una aprobación.</small><button disabled={busy}>Activar entrada</button>
        </form>
      </article> : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Listas protegidas</h2><p>Las referencias originales nunca se muestran ni se exportan</p></div><b>READ ONLY</b></div><p>Owner y admin administran listas. Tu rol conserva acceso al resultado y a la trazabilidad enmascarada.</p></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Registro de listas</h2><p>Estado actual e historial deshabilitado</p></div><b>{activeListEntries.length} activas</b></div><div className="integration-list compact-list">
        {listEntries.length === 0 ? <div><span><strong>Sin entradas</strong><small>El baseline y las reglas champion siguen activos.</small></span><b>—</b></div> : listEntries.map((entry) => <div key={entry.id}><span><strong>{entry.subjectPreview}</strong><small>{entry.subjectType} · {entry.reason}{entry.expiresAt ? ` · vence ${new Date(entry.expiresAt).toLocaleString('es-AR')}` : ''}</small></span><b className={entry.status === 'active' ? 'active' : ''}>{entry.category}</b>{canManageRules && entry.status === 'active' && <span className="policy-actions"><button disabled={busy} onClick={() => void disableListEntry(entry.id)}>Deshabilitar</button></span>}</div>)}
      </div></article>
    </div>
    <div className="integration-grid risk-grid step-up-grid">
      {canResolve ? <article className="integration-card"><div className="card-head"><div><h2>Iniciar step-up</h2><p>OTP de un solo uso para evaluaciones en revisión</p></div><b>NATIVE</b></div>
        <form className="integration-form risk-rule-form" onSubmit={createStepUp}><label>Evaluación<select name="evaluationId" required disabled={reviewEvaluations.length === 0}><option value="">Seleccionar evaluación</option>{reviewEvaluations.map((evaluation) => <option key={evaluation.id} value={evaluation.id}>{evaluation.counterparty} · {money(evaluation.amount, evaluation.currency)} · score {evaluation.score}</option>)}</select></label>
          <div className="integration-fields"><label>Expiración<select name="expiresInSeconds" defaultValue="300"><option value="180">3 minutos</option><option value="300">5 minutos</option><option value="600">10 minutos</option></select></label><label>Intentos máximos<input name="maxAttempts" type="number" min="1" max="10" defaultValue="5" required /></label></div>
          <small>Cimbra genera, cifra y hashea la credencial. El cliente la entrega por su canal aprobado; esto no es 3DS ni un ACS certificado.</small><button disabled={busy || reviewEvaluations.length === 0}>Crear challenge</button>
        </form>
      </article> : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Step-up protegido</h2><p>Tu rol conserva la evidencia, sin acceso a credenciales</p></div><b>READ ONLY</b></div><p>Owner, admin y operator pueden crear y verificar challenges. Viewer sólo consulta lifecycle, expiración y resultado.</p></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Verificación y lifecycle</h2><p>Intentos append-only, expiración y lock por challenge</p></div><b>{pendingStepUps.length} pendientes</b></div>
        {canResolve && <form className="integration-form risk-rule-form" onSubmit={verifyStepUp}><label>Challenge<select name="challengeId" required disabled={pendingStepUps.length === 0}><option value="">Seleccionar challenge</option>{pendingStepUps.map((challenge) => { const evaluation = evaluations.find((item) => item.id === challenge.evaluationId); return <option key={challenge.id} value={challenge.id}>{evaluation?.counterparty ?? challenge.evaluationId} · {challenge.remainingAttempts} intentos</option>; })}</select></label><label>Código OTP<input name="credential" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" placeholder="000000" required /></label><button disabled={busy || pendingStepUps.length === 0}>Verificar código</button></form>}
        <div className="integration-list compact-list">{stepUpChallenges.length === 0 ? <div><span><strong>Sin challenges</strong><small>Las evaluaciones review pueden elevar autenticación sin resolver el caso automáticamente.</small></span><b>—</b></div> : stepUpChallenges.slice(0, 20).map((challenge) => { const evaluation = evaluations.find((item) => item.id === challenge.evaluationId); return <div key={challenge.id}><span><strong>{evaluation?.counterparty ?? challenge.evaluationId}</strong><small>{challenge.method} · {challenge.attemptCount}/{challenge.maxAttempts} intentos · vence {new Date(challenge.expiresAt).toLocaleString('es-AR')}</small></span><b className={challenge.status === 'verified' ? 'active' : ''}>{challenge.status}</b></div>; })}</div>
      </article>
    </div>
    <div className="integration-grid risk-grid">
      {canResolve ? <article className="integration-card"><div className="card-head"><div><h2>Resultado confirmado</h2><p>Etiqueta legítima o fraude para medir calidad real</p></div><b>APPEND ONLY</b></div>
        <form className="integration-form risk-rule-form" onSubmit={reportOutcome}><label>Evaluación<select name="evaluationId" required><option value="">Seleccionar evaluación</option>{evaluations.map((evaluation) => <option key={evaluation.id} value={evaluation.id}>{evaluation.counterparty} · {money(evaluation.amount, evaluation.currency)} · {evaluation.decision}{evaluation.outcome ? ` · corrige ${evaluation.outcome.label}` : ''}</option>)}</select></label>
          <div className="integration-fields"><label>Resultado<select value={outcomeLabel} onChange={(event) => setOutcomeLabel(event.target.value as 'legitimate' | 'fraud')}><option value="legitimate">Legítima</option><option value="fraud">Fraude</option></select></label>{outcomeLabel === 'fraud' && <label>Tipo<select name="fraudType"><option value="account_takeover">Account takeover</option><option value="identity_fraud">Fraude de identidad</option><option value="scam">Estafa</option><option value="stolen_instrument">Instrumento robado</option><option value="merchant_fraud">Fraude comercio</option><option value="other">Otro</option></select></label>}</div>
          {outcomeLabel === 'fraud' && <div className="integration-fields"><label>Pérdida<input name="lossAmount" inputMode="decimal" defaultValue="0" /></label><label>Moneda<select name="currency"><option>ARS</option><option>USD</option><option>MXN</option><option>COP</option><option>BRL</option><option>CLP</option><option>PEN</option></select></label></div>}
          <label>Nota operativa<textarea name="note" rows={3} maxLength={500} placeholder="Evidencia, fuente o contexto de confirmación" /></label><small>Si la evaluación ya tiene resultado, Cimbra crea una corrección vinculada y conserva la versión anterior.</small><button disabled={busy || evaluations.length === 0}>Registrar resultado</button>
        </form>
      </article> : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Resultados protegidos</h2><p>La carga está reservada a roles que resuelven casos</p></div><b>READ ONLY</b></div><p>Las etiquetas existentes y sus métricas siguen visibles para auditoría.</p></article>}
      <article className="integration-card"><div className="card-head"><div><h2>Rendimiento confirmado</h2><p>Matriz sobre resultados activos, separada del proxy operativo</p></div><b>{metrics.confirmed.total} etiquetas</b></div><div className="integration-list compact-list">
        <div><span><strong>Precisión</strong><small>TP {metrics.confirmed.truePositives} · FP {metrics.confirmed.falsePositives}</small></span><b>{metrics.confirmed.precision === null ? '—' : `${metrics.confirmed.precision}%`}</b></div>
        <div><span><strong>Recall</strong><small>TP {metrics.confirmed.truePositives} · FN {metrics.confirmed.falseNegatives}</small></span><b>{metrics.confirmed.recall === null ? '—' : `${metrics.confirmed.recall}%`}</b></div>
        <div><span><strong>Tasa de falsos positivos</strong><small>FP {metrics.confirmed.falsePositives} · TN {metrics.confirmed.trueNegatives}</small></span><b>{metrics.confirmed.falsePositiveRate === null ? '—' : `${metrics.confirmed.falsePositiveRate}%`}</b></div>
        {metrics.confirmed.losses.map((loss) => <div key={loss.currency}><span><strong>Pérdida confirmada · {loss.currency}</strong><small>{loss.count} resultados de fraude</small></span><b>{money(loss.amount, loss.currency)}</b></div>)}
      </div></article>
    </div>
    <p className="risk-metric-note">SLO de decisión: p50 {metrics.decisionSlo.p50Ms ?? '—'} ms · p95 {metrics.decisionSlo.p95Ms ?? '—'} ms · p99 {metrics.decisionSlo.p99Ms ?? '—'} ms · cumplimiento ≤ {metrics.decisionSlo.targetMs} ms: {metrics.decisionSlo.complianceRate === null ? '—' : `${metrics.decisionSlo.complianceRate}%`} sobre {metrics.decisionSlo.samples} muestras. Precisión, recall y falsos positivos usan sólo outcomes confirmados.</p>
    <article className="module-list hold-list"><div className="card-head"><div><h2>Cola de decisión</h2><p>Casos explicables vinculados a evaluaciones y reservas</p></div><b>{openCases.length} abiertos</b></div>
      {openCases.length === 0 ? <div><span className="movement"><i>✓</i><b>Sin casos pendientes<small>Las evaluaciones aprobadas no generan trabajo manual</small></b></span><strong>Al día</strong></div> : openCases.map((riskCase) => <div key={riskCase.id}><span className="movement"><i>!</i><b>{riskCase.counterparty}<small>{money(riskCase.amount, riskCase.currency)} · score {riskCase.score} · {riskCase.reasons.join(', ') || 'política manual'}</small></b></span>{canResolve ? <span className="hold-actions"><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'declined')}>Rechazar</button><button disabled={busy} onClick={() => void resolveCase(riskCase.id, 'approved')}>Aprobar</button></span> : <strong>Pendiente</strong>}</div>)}
      {unlinkedHolds.map((hold) => <div key={hold.id}><span className="movement"><i>◇</i><b>{hold.counterparty}<small>Reserva anterior sin caso · {hold.description} · {money(hold.amount, hold.currency)}</small></b></span>{canResolve ? <span className="hold-actions"><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'release')}>Liberar</button><button disabled={externalBusy} onClick={() => void onHold(hold.id, 'capture')}>Capturar</button></span> : <strong>Reservado</strong>}</div>)}
    </article>
    <article className="module-list"><div className="card-head"><div><h2>Evaluaciones recientes</h2><p>Score, latencia, señales derivadas y resultado confirmado</p></div><b>{evaluations.length}</b></div>{evaluations.slice(0, 20).map((evaluation) => <div key={evaluation.id}><span className="movement"><i>{evaluation.decision === 'approve' ? '✓' : '!'}</i><b>{evaluation.counterparty}<small>{money(evaluation.amount, evaluation.currency)} · {evaluation.decisionLatencyMs === null ? 'latencia histórica no medida' : `${evaluation.decisionLatencyMs} ms`} · {evaluation.reasons.join(', ') || 'baseline'}{evaluation.signals.deviceReferencePresent ? ' · dispositivo' : ''}{evaluation.signals.identityReferencePresent ? ' · identidad' : ''}</small></b></span><strong>{evaluation.score} · {evaluation.outcome?.label ?? evaluation.decision}</strong></div>)}</article>
  </div>;
}
