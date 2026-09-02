'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { ORGANIZATION_COUNTRIES } from '@/app/lib/platform/support-input';

type Organization = {
  id: string; name: string; slug: string; country: string; status: string; createdAt: string; memberCount: number;
};

const COUNTRY_LABELS: Record<string, string> = {
  AR: 'Argentina', MX: 'México', CO: 'Colombia', BR: 'Brasil', CL: 'Chile', PE: 'Perú',
};

export default function OrganizationPanel({ canManage }: { canManage: boolean }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    void authenticatedFetch('/api/v1/organization').then(async (response) => {
      const result = await response.json() as { data?: Organization; error?: string | { message?: string } };
      if (!active) return;
      if (response.ok && result.data) setOrganization(result.data);
      else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar la organización.');
      setBusy(false);
    }).catch(() => { if (active) { setFeedback('No pudimos conectar con la organización.'); setBusy(false); } });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch('/api/v1/organization', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: values.get('name'), country: values.get('country') }),
    });
    const result = await response.json() as { organization?: Organization; replayed?: boolean; error?: string | { message?: string } };
    if (response.ok && result.organization) {
      setOrganization(result.organization);
      setFeedback(result.replayed ? 'No había cambios para guardar.' : 'Organización actualizada con auditoría y evento organization.updated.');
    } else setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos actualizar la organización.');
    setBusy(false);
  }

  return <div className="module-view">
    <div className="module-view-head">
      <div><p>ORGANIZACIÓN</p><h1>Perfil del tenant</h1><span>Identidad comercial y jurisdicción declarada. El slug es inmutable porque forma parte del aislamiento del tenant.</span></div>
      <span className="module-health"><i /> {organization?.status ?? 'cargando'}</span>
    </div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {!organization ? <p className="operations-empty">{busy ? 'Cargando organización…' : 'No hay datos de organización disponibles.'}</p> : <>
      <div className="module-metrics">
        <article><strong>{organization.memberCount}</strong><span>miembros activos</span></article>
        <article><strong>{COUNTRY_LABELS[organization.country] ?? organization.country}</strong><span>jurisdicción declarada</span></article>
        <article><strong>{new Date(organization.createdAt).toLocaleDateString('es-AR')}</strong><span>alta del tenant</span></article>
      </div>
      <form className="case-form" onSubmit={save}>
        <div>
          <label>Nombre comercial<input name="name" defaultValue={organization.name} minLength={2} maxLength={80} required disabled={!canManage} /></label>
          <label>País<select name="country" defaultValue={organization.country} disabled={!canManage}>{ORGANIZATION_COUNTRIES.map((country) => <option key={country} value={country}>{COUNTRY_LABELS[country]}</option>)}</select></label>
        </div>
        <label>Identificador<input value={organization.slug} readOnly disabled /></label>
        {canManage
          ? <div className="case-actions"><button disabled={busy}>Guardar cambios</button></div>
          : <p className="operations-empty">Tu rol puede consultar el perfil pero no modificarlo. Pedí el cambio a un owner o admin.</p>}
      </form>
    </>}
  </div>;
}
