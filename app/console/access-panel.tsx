'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ROLE_PROFILES, canManageRole, type OrganizationRole } from '@/app/lib/platform/access-policy';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Role = OrganizationRole;
type Member = { id: string; userId: string; email: string; displayName: string; role: Role; emailVerified: boolean; mfaEnabled: boolean; createdAt: string };
type Invitation = { id: string; email: string; role: Exclude<Role, 'owner'>; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invitedByName: string; expiresAt: string; acceptedAt: string | null; createdAt: string };
type AccessState = { members: Member[]; invitations: Invitation[] };

export default function AccessPanel({ actorRole }: { actorRole: Extract<Role, 'owner' | 'admin'> }) {
  const [state, setState] = useState<AccessState>({ members: [], invitations: [] });
  const [currentUserId, setCurrentUserId] = useState('');
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const pending = useMemo(() => state.invitations.filter((item) => item.status === 'pending'), [state.invitations]);

  async function load() {
    const response = await authenticatedFetch('/api/platform/access', { cache: 'no-store' });
    const result = await response.json() as { data?: AccessState; current?: { userId: string }; error?: string };
    if (!response.ok) return setFeedback(result.error ?? 'No pudimos cargar los accesos.');
    setState(result.data ?? { members: [], invitations: [] }); setCurrentUserId(result.current?.userId ?? '');
  }

  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/platform/access', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) });
    const result = await response.json() as { error?: string; emailSent?: boolean };
    setFeedback(response.ok ? result.emailSent ? 'Invitación creada y enviada por email.' : 'Invitación creada. El email transaccional no está configurado; compartí el acceso de forma segura.'
      : result.error ?? 'No pudimos crear la invitación.');
    if (response.ok) { formElement.reset(); await load(); } setBusy(false);
  }

  async function changeRole(member: Member, role: Exclude<Role, 'owner'>) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/access/members/${member.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? `Rol de ${member.displayName} actualizado.` : result.error ?? 'No pudimos actualizar el rol.');
    if (response.ok) await load(); setBusy(false);
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`¿Quitar el acceso de ${member.displayName}? La cuenta seguirá existiendo, pero saldrá de esta organización.`)) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/access/members/${member.id}`, { method: 'DELETE' });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? `Acceso de ${member.displayName} eliminado.` : result.error ?? 'No pudimos quitar el acceso.');
    if (response.ok) await load(); setBusy(false);
  }

  async function revoke(invitation: Invitation) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/access/invitations/${invitation.id}`, { method: 'DELETE' });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? `Invitación para ${invitation.email} revocada.` : result.error ?? 'No pudimos revocar la invitación.');
    if (response.ok) await load(); setBusy(false);
  }

  function manageable(member: Member) {
    return member.userId !== currentUserId && canManageRole(actorRole, member.role);
  }

  return <div className="module-view access-console">
    <div className="module-view-head"><div><p>IDENTITY & ACCESS</p><h1>Equipo y permisos</h1><span>Accesos por tenant, privilegio mínimo y cambios auditados.</span></div><span className="module-health"><i /> {state.members.length} miembros activos</span></div>
    {feedback && <div className="form-feedback ledger-feedback" role="status">{feedback}</div>}
    <div className="module-metrics"><article><strong>{state.members.length}</strong><span>miembros</span></article><article><strong>{pending.length}</strong><span>invitaciones pendientes</span></article><article><strong>{state.members.filter((item) => item.mfaEnabled).length}</strong><span>con MFA</span></article></div>
    <div className="access-layout"><article className="integration-card"><div className="card-head"><div><h2>Invitar operador</h2><p>El email debe verificarse antes de ingresar al tenant</p></div><b>7 DÍAS</b></div><form className="integration-form" onSubmit={invite}><label>Email corporativo<input name="email" type="email" autoComplete="email" maxLength={254} required /></label><label>Rol<select name="role" defaultValue="operator">{actorRole === 'owner' && <option value="admin">Admin</option>}<option value="operator">Operator</option><option value="viewer">Viewer</option></select></label><button disabled={busy}>{busy ? 'Procesando…' : 'Crear invitación →'}</button></form></article>
      <article className="integration-card"><div className="card-head"><div><h2>Matriz de roles</h2><p>Perfiles canónicos de esta versión</p></div><b>RBAC</b></div><div className="role-matrix">{(Object.keys(ROLE_PROFILES) as Role[]).map((role) => <div key={role}><b>{ROLE_PROFILES[role].label}</b><span>{ROLE_PROFILES[role].description}</span></div>)}</div></article></div>
    <article className="module-list access-members"><div className="card-head"><div><h2>Miembros activos</h2><p>Identidad, seguridad y rol efectivo</p></div><b>{state.members.length}</b></div>{state.members.map((member) => <div key={member.id}><span className="movement"><i>{member.displayName.slice(0, 2).toUpperCase()}</i><b>{member.displayName}<small>{member.email} · {member.emailVerified ? 'email verificado' : 'email pendiente'} · {member.mfaEnabled ? 'MFA activo' : 'sin MFA'}</small></b></span><span className="access-actions">{manageable(member) ? <><select aria-label={`Rol de ${member.displayName}`} value={member.role} disabled={busy} onChange={(event) => void changeRole(member, event.target.value as Exclude<Role, 'owner'>)}>{actorRole === 'owner' && <option value="admin">Admin</option>}<option value="operator">Operator</option><option value="viewer">Viewer</option></select><button disabled={busy} onClick={() => void removeMember(member)}>Quitar</button></> : <b>{ROLE_PROFILES[member.role].label}{member.userId === currentUserId ? ' · vos' : ''}</b>}</span></div>)}</article>
    <article className="module-list access-invitations"><div className="card-head"><div><h2>Historial de invitaciones</h2><p>Altas, vencimientos y revocaciones persistidas</p></div><b>{state.invitations.length}</b></div>{state.invitations.length === 0 ? <div><span className="movement"><i>＋</i><b>Sin invitaciones<small>Creá la primera para sumar un operador</small></b></span><strong>Vacío</strong></div> : state.invitations.map((invitation) => <div key={invitation.id}><span className="movement"><i>✉</i><b>{invitation.email}<small>{ROLE_PROFILES[invitation.role].label} · invitó {invitation.invitedByName} · vence {new Date(invitation.expiresAt).toLocaleDateString('es-AR')}</small></b></span><span className="access-actions"><b className={invitation.status}>{invitation.status}</b>{invitation.status === 'pending' && canManageRole(actorRole, invitation.role) && <button disabled={busy} onClick={() => void revoke(invitation)}>Revocar</button>}</span></div>)}</article>
  </div>;
}
