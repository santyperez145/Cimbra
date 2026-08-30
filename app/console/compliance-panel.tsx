'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { roleCan, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type CheckType = 'identity_document' | 'address' | 'sanctions' | 'pep' | 'business_registry' | 'beneficial_ownership';
type CaseStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'expired';
type Party = { id: string; role: 'subject' | 'legal_representative' | 'beneficial_owner' | 'director'; name: string; taxIdLast4: string; ownershipPercentage: number | null; pepDeclared: boolean; createdByName: string; createdAt: string };
type Check = { id: string; checkType: CheckType; source: 'manual_review' | 'official_registry' | 'internal_list'; status: 'pending' | 'passed' | 'failed' | 'review'; resultCode: string; note: string; evidenceDocumentId: string | null; evidenceFileName: string | null; checkedByName: string; createdAt: string };
type LifecycleEvent = { id: string; event: 'created' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'expired'; fromStatus: CaseStatus | null; toStatus: CaseStatus; actorId: string; actorName: string; createdAt: string };
type DueCase = { id: string; customerId: string; customerName: string; customerType: 'individual' | 'business'; country: string; taxIdLast4: string; kind: 'kyc' | 'kyb'; jurisdiction: string; policyVersion: string; requiredChecks: CheckType[]; completedRequiredChecks: number; readyForReview: boolean; status: CaseStatus; riskRating: 'unassessed' | 'low' | 'medium' | 'high' | 'prohibited'; expiresAt: string; createdBy: string; createdByName: string; submittedBy: string | null; submittedByName: string | null; submittedAt: string | null; resolvedByName: string | null; resolutionNote: string | null; resolvedAt: string | null; parties: Party[]; checks: Check[]; events: LifecycleEvent[] };
type DueState = { policy: { version: string; kycRequiredChecks: CheckType[]; kybRequiredChecks: CheckType[]; boundary: string }; metrics: { total: number; drafts: number; inReview: number; approved: number; rejected: number }; cases: DueCase[]; customers: Array<{ id: string; type: 'individual' | 'business'; name: string; country: string; taxIdLast4: string; status: string }>; documents: Array<{ id: string; fileName: string; contentType: string; size: number; status: string; createdAt: string }> };

const checkLabels: Record<CheckType, string> = {
  identity_document: 'Documento de identidad', address: 'Domicilio', sanctions: 'Sanciones', pep: 'PEP',
  business_registry: 'Registro societario', beneficial_ownership: 'Beneficiarios finales',
};
const statusLabels: Record<CaseStatus, string> = { draft: 'Borrador', in_review: 'En revisión', approved: 'Aprobado', rejected: 'Rechazado', cancelled: 'Cancelado', expired: 'Vencido' };
const partyLabels: Record<Party['role'], string> = { subject: 'Titular', legal_representative: 'Representante legal', beneficial_owner: 'Beneficiario final', director: 'Director' };

function apiError(body: { error?: { message?: string } | string }) {
  return typeof body.error === 'string' ? body.error : body.error?.message ?? 'No pudimos completar la operación.';
}

export default function CompliancePanel({ actorRole, mfaEnabled, currentUserId }: {
  actorRole: OrganizationRole; mfaEnabled: boolean; currentUserId: string;
}) {
  const [state, setState] = useState<DueState | null>(null); const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const [partyRole, setPartyRole] = useState<Party['role']>('legal_representative');
  const [decisionChoice, setDecisionChoice] = useState<'approve' | 'reject'>('approve');
  const canWrite = roleCan(actorRole, 'compliance.write'); const canDecide = roleCan(actorRole, 'approvals.decide');
  const selected = useMemo(() => state?.cases.find((item) => item.id === selectedId) ?? state?.cases[0] ?? null, [selectedId, state]);

  const load = useCallback(async () => {
    const response = await authenticatedFetch('/api/v1/due-diligence', { cache: 'no-store' });
    const result = await response.json() as { data?: DueState; error?: { message?: string } | string };
    if (!response.ok || !result.data) return setFeedback(apiError(result));
    setState(result.data); setSelectedId((current) => current && result.data!.cases.some((item) => item.id === current) ? current : result.data!.cases[0]?.id ?? '');
  }, []);

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);

  async function jsonMutation(path: string, body?: Record<string, unknown>) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as { error?: { message?: string } | string; case?: DueCase };
    setFeedback(response.ok ? 'Operación registrada con trazabilidad e idempotencia.' : apiError(result));
    if (response.ok) { if (result.case?.id) setSelectedId(result.case.id); await load(); }
    setBusy(false); return response.ok;
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await jsonMutation('/api/v1/due-diligence/cases', { customerId: form.get('customerId'), expiresInDays: Number(form.get('expiresInDays')) });
    if (ok) event.currentTarget.reset();
  }

  async function addParty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const ok = await jsonMutation(`/api/v1/due-diligence/cases/${selected.id}/parties`, { role: form.get('role'), name: form.get('name'), taxId: form.get('taxId'),
      ownershipPercentage: form.get('ownershipPercentage') || undefined, pepDeclared: form.get('pepDeclared') === 'on' });
    if (ok) event.currentTarget.reset();
  }

  async function addCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const ok = await jsonMutation(`/api/v1/due-diligence/cases/${selected.id}/checks`, { checkType: form.get('checkType'), source: form.get('source'), status: form.get('status'), resultCode: form.get('resultCode'), note: form.get('note'), evidenceDocumentId: form.get('evidenceDocumentId') || undefined });
    if (ok) event.currentTarget.reset();
  }

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    await jsonMutation(`/api/v1/due-diligence/cases/${selected.id}/decide`, { decision: form.get('decision'), riskRating: form.get('riskRating'), note: form.get('note') });
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/compliance/documents', { method: 'POST', body: new FormData(event.currentTarget) });
    const result = await response.json() as { error?: string; document?: { fileName: string } };
    setFeedback(response.ok ? `${result.document?.fileName ?? 'Documento'} almacenado de forma privada.` : result.error ?? 'No pudimos subir el documento.');
    if (response.ok) { event.currentTarget.reset(); await load(); } setBusy(false);
  }

  if (!state) return <div className="module-view"><div className="module-view-head"><div><p>CDD ORCHESTRATION</p><h1>KYC y KYB</h1><span>Cargando política y expedientes tenant-scoped…</span></div></div>{feedback && <div className="form-feedback" role="alert">{feedback}</div>}</div>;

  return <div className="module-view compliance-console">
    <div className="module-view-head"><div><p>CDD · KYC / KYB NATIVO</p><h1>Identidad y debida diligencia</h1><span>Expedientes versionados, evidencia append-only y decisión independiente.</span></div><span className="module-health"><i /> Política {state.policy.version}</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics compliance-metrics"><article><strong>{state.metrics.total}</strong><span>expedientes</span></article><article><strong>{state.metrics.drafts}</strong><span>borradores</span></article><article><strong>{state.metrics.inReview}</strong><span>en revisión</span></article><article><strong>{state.metrics.approved}</strong><span>aprobados</span></article></div>
    <div className="compliance-onboarding-grid">
      {canWrite ? <article className="integration-card"><div className="card-head"><div><h2>Nuevo expediente</h2><p>El tipo de cliente define KYC o KYB</p></div><b>NATIVE</b></div><form className="integration-form" onSubmit={createCase}><label>Cliente<select name="customerId" required defaultValue=""><option value="" disabled>Seleccionar cliente</option>{state.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.type === 'business' ? 'KYB' : 'KYC'} · {customer.country}</option>)}</select></label><label>Vigencia<select name="expiresInDays" defaultValue="90"><option value="30">30 días</option><option value="90">90 días</option><option value="180">180 días</option><option value="365">365 días</option></select></label><button disabled={busy || state.customers.length === 0}>Crear expediente</button><small>Un solo expediente activo por cliente. La política requerida queda congelada por versión.</small></form></article>
        : <article className="integration-card role-boundary-card"><div className="card-head"><div><h2>Operación protegida</h2><p>Tu rol conserva lectura y auditoría completas</p></div><b>READ ONLY</b></div><p>Owner, admin y operator pueden preparar expedientes. Viewer no ve acciones mutantes ni puede cargar evidencia.</p></article>}
      {canWrite ? <article className="integration-card"><div className="card-head"><div><h2>Evidencia privada</h2><p>PDF, JPG o PNG hasta 5 MB</p></div><b>{state.documents.length}</b></div><form className="integration-form" onSubmit={uploadDocument}><label>Archivo<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><button disabled={busy}>Subir evidencia</button><small>El archivo queda aislado por tenant; los checks sólo pueden vincular documentos de la misma organización.</small></form></article>
        : <article className="integration-card"><div className="card-head"><div><h2>Inventario de evidencia</h2><p>Metadata visible sin acciones mutantes</p></div><b>{state.documents.length}</b></div><div className="integration-list compact-list">{state.documents.slice(0, 6).map((document) => <div key={document.id}><span><strong>{document.fileName}</strong><small>{Math.ceil(document.size / 1024)} KB · {new Date(document.createdAt).toLocaleDateString('es-AR')}</small></span><b>{document.status}</b></div>)}</div></article>}
    </div>
    <div className="cdd-workspace">
      <article className="cdd-case-list"><div className="card-head"><div><h2>Expedientes</h2><p>Lifecycle y vencimiento persistidos</p></div><b>{state.cases.length}</b></div>{state.cases.length === 0 ? <div className="card-empty"><strong>Sin expedientes</strong><span>Creá el primero desde un cliente canónico.</span></div> : state.cases.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><i className={`cdd-status ${item.status}`} /><span><strong>{item.customerName}</strong><small>{item.kind.toUpperCase()} · {item.country} · {item.completedRequiredChecks}/{item.requiredChecks.length} checks</small></span><b>{statusLabels[item.status]}</b></button>)}</article>
      <section className="cdd-case-detail">{!selected ? <div className="card-empty"><strong>Seleccioná un expediente</strong></div> : <>
        <header><div><small>{selected.kind.toUpperCase()} · {selected.policyVersion}</small><h2>{selected.customerName}</h2><p>{selected.customerType === 'business' ? 'Persona jurídica' : 'Persona humana'} · {selected.jurisdiction} · ID terminado en {selected.taxIdLast4}</p></div><span className={`cdd-case-badge ${selected.status}`}>{statusLabels[selected.status]}</span></header>
        <div className="cdd-progress"><div><span>Requisitos documentados</span><strong>{selected.completedRequiredChecks} / {selected.requiredChecks.length}</strong></div><progress max={selected.requiredChecks.length} value={selected.completedRequiredChecks} /><small>Vence {new Date(selected.expiresAt).toLocaleString('es-AR')} · riesgo {selected.riskRating}</small></div>
        <div className="cdd-columns"><div><h3>Checks de política</h3><div className="cdd-requirements">{selected.requiredChecks.map((type) => { const latest = selected.checks.find((check) => check.checkType === type); return <div key={type}><i className={latest?.status ?? 'missing'}>{latest?.status === 'passed' ? '✓' : latest ? '!' : '·'}</i><span><strong>{checkLabels[type]}</strong><small>{latest ? `${latest.status} · ${latest.source} · ${latest.checkedByName}` : 'Sin observación'}</small></span></div>; })}</div></div><div><h3>Partes relacionadas</h3><div className="cdd-parties">{selected.parties.length === 0 ? <p>Sin partes registradas.</p> : selected.parties.map((party) => <div key={party.id}><span><strong>{party.name}</strong><small>{partyLabels[party.role]} · ID •••• {party.taxIdLast4}{party.ownershipPercentage ? ` · ${party.ownershipPercentage}%` : ''}{party.pepDeclared ? ' · PEP declarada' : ''}</small></span></div>)}</div></div></div>
        {canWrite && selected.status === 'draft' && <div className="cdd-action-grid">
          <form className="integration-form cdd-form" onSubmit={addParty}><h3>Agregar parte</h3><label>Rol<select name="role" value={selected.kind === 'kyc' ? 'subject' : partyRole} onChange={(event) => setPartyRole(event.target.value as Party['role'])} disabled={selected.kind === 'kyc'}>{selected.kind === 'kyc' ? <option value="subject">Titular</option> : <><option value="legal_representative">Representante legal</option><option value="beneficial_owner">Beneficiario final</option><option value="director">Director</option></>}</select></label><label>Nombre<input name="name" minLength={2} maxLength={160} required /></label><div className="integration-fields"><label>Identificación<input name="taxId" minLength={4} autoComplete="off" required /></label>{selected.kind === 'kyb' && partyRole === 'beneficial_owner' && <label>Participación %<input name="ownershipPercentage" type="number" min="0.01" max="100" step="0.01" required /></label>}</div><label className="cdd-checkbox"><input name="pepDeclared" type="checkbox" /> PEP declarada por la parte</label><button disabled={busy}>Agregar parte</button></form>
          <form className="integration-form cdd-form" onSubmit={addCheck}><h3>Registrar check</h3><label>Control<select name="checkType">{selected.requiredChecks.map((type) => <option key={type} value={type}>{checkLabels[type]}</option>)}</select></label><div className="integration-fields"><label>Fuente<select name="source"><option value="manual_review">Revisión manual</option><option value="official_registry">Registro oficial directo</option><option value="internal_list">Lista interna</option></select></label><label>Resultado<select name="status"><option value="passed">Superado</option><option value="review">Revisar</option><option value="failed">Fallido</option><option value="pending">Pendiente</option></select></label></div><label>Código de resultado<input name="resultCode" minLength={2} maxLength={80} placeholder="verified_manual" required /></label><label>Nota<textarea name="note" minLength={3} maxLength={1000} rows={3} required /></label><label>Evidencia<select name="evidenceDocumentId"><option value="">Sin archivo asociado</option>{state.documents.map((document) => <option key={document.id} value={document.id}>{document.fileName}</option>)}</select></label><button disabled={busy}>Registrar check</button></form>
        </div>}
        <div className="cdd-decision-bar">{selected.status === 'draft' && canWrite && <><button disabled={busy || !selected.readyForReview} onClick={() => void jsonMutation(`/api/v1/due-diligence/cases/${selected.id}/submit`)}>{selected.readyForReview ? 'Enviar a revisión' : 'Completá requisitos'}</button><button className="secondary" disabled={busy} onClick={() => { const note = window.prompt('Motivo de cancelación:'); if (note && note.trim().length >= 3) void jsonMutation(`/api/v1/due-diligence/cases/${selected.id}/cancel`, { note }); }}>Cancelar expediente</button></>}{selected.status === 'in_review' && (!canDecide ? <span>Esperando decisión de owner/admin con MFA.</span> : !mfaEnabled ? <span>Activá MFA para decidir este expediente.</span> : selected.submittedBy === currentUserId ? <span>Sos el maker; debe decidir otro owner/admin con MFA.</span> : <form onSubmit={decide}><select name="decision" value={decisionChoice} onChange={(event) => setDecisionChoice(event.target.value as 'approve' | 'reject')}><option value="approve">Aprobar</option><option value="reject">Rechazar</option></select><select name="riskRating"><option value="low">Riesgo bajo</option><option value="medium">Riesgo medio</option><option value="high">Riesgo alto</option>{decisionChoice === 'reject' && <option value="prohibited">Riesgo prohibido</option>}</select><input name="note" minLength={3} maxLength={1000} placeholder="Fundamento de la decisión" required /><button disabled={busy}>Registrar decisión</button></form>)}{['approved', 'rejected', 'cancelled', 'expired'].includes(selected.status) && <span>Estado terminal · {selected.resolvedByName ? `${selected.resolvedByName}: ` : ''}{selected.resolutionNote ?? 'sin resolución manual'}</span>}</div>
        <div className="cdd-history"><h3>Historial inmutable</h3>{selected.events.map((item) => <article key={item.id}><i /><div><strong>{statusLabels[item.toStatus]}</strong><span>{item.actorName} · {new Date(item.createdAt).toLocaleString('es-AR')}</span></div></article>)}</div>
      </>}</section>
    </div>
    <div className="card-sandbox-boundary"><strong>Límite operativo honesto</strong><span>{state.policy.boundary} Cimbra no se conecta a BIND, Dock, tapi, Pismo, Pomelo ni Wibond; una verificación externa sólo será válida mediante fuente oficial, banco, autoridad o proveedor certificado contratado directamente.</span></div>
  </div>;
}
