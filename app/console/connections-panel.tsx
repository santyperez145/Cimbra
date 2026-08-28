'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Provider = {
  id: string; name: string; role: string; coverage: string; capabilities: string[]; transports: string[];
  onboarding: string; documentationUrl: string;
};

type Connection = {
  id: string; provider: string; name: string; environment: string; capabilities: string[]; transport: string;
  status: string; credentialConfigured: boolean; createdAt: string;
};

export default function ConnectionsPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('bindx');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const provider = useMemo(() => providers.find((item) => item.id === selectedProvider), [providers, selectedProvider]);

  async function load() {
    const [catalogResponse, connectionsResponse] = await Promise.all([
      fetch('/api/v1/providers', { cache: 'no-store' }), fetch('/api/v1/connections?limit=100', { cache: 'no-store' }),
    ]);
    const catalog = await catalogResponse.json() as { data?: Provider[]; error?: { message?: string } | string };
    const inventory = await connectionsResponse.json() as { data?: Connection[]; error?: { message?: string } | string };
    if (!catalogResponse.ok || !connectionsResponse.ok) {
      const error = catalog.error ?? inventory.error;
      setFeedback(typeof error === 'string' ? error : error?.message ?? 'No pudimos cargar las conexiones.');
    } else {
      setProviders(catalog.data ?? []); setConnections(inventory.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, []);

  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/v1/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        provider: selectedProvider, name: form.get('name'), environment: form.get('environment'),
        capabilities: form.getAll('capabilities'), transport: form.get('transport'), credentialReference: form.get('credentialReference'),
        configuration: form.get('country') ? { country: form.get('country') } : {},
      }),
    });
    const result = await response.json() as { error?: { message?: string } | string };
    const error = typeof result.error === 'string' ? result.error : result.error?.message;
    if (!response.ok) setFeedback(error ?? 'No pudimos registrar la conexión.');
    else { setFeedback('Conexión registrada. Queda pendiente de validación y homologación.'); event.currentTarget.reset(); await load(); }
    setBusy(false);
  }

  return <div className="module-view">
    <div className="module-view-head"><div><p>PROVIDER CONTROL PLANE</p><h1>Conexiones financieras</h1><span>Adaptadores regionales desacoplados del ledger y de la API canónica.</span></div><span className="module-health"><i /> {connections.length} configuradas</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="compliance-grid connections-grid">
      <article className="upload-card connection-form"><div className="module-icon">⌘</div><h2>Registrar conexión</h2><p>Guardamos una referencia cifrada al gestor de secretos. Nunca pegues una API key o contraseña.</p>
        <form onSubmit={createConnection}>
          <label>Proveedor<select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>{providers.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Nombre<input name="name" placeholder="BIND Argentina" required minLength={2} maxLength={80} /></label>
          <div className="form-split"><label>Ambiente<select name="environment"><option value="sandbox">Sandbox</option><option value="production">Producción</option></select></label><label>País<input name="country" placeholder="AR" pattern="[A-Z]{2}" maxLength={2} /></label></div>
          <label>Transporte<select name="transport">{provider?.transports.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
          <label>Capacidades<select name="capabilities" multiple required size={Math.min(provider?.capabilities.length ?? 3, 6)}>{provider?.capabilities.map((item)=><option key={item} value={item}>{item}</option>)}</select></label>
          <label>Referencia del secreto<input name="credentialReference" placeholder="aws-secretsmanager://cimbra/providers/bindx" required /></label>
          <button disabled={busy || !provider}>{busy ? 'Registrando…' : 'Registrar conexión →'}</button>
        </form>
      </article>
      <article className="review-queue"><div className="card-head"><div><h2>Inventario de conexiones</h2><p>Credenciales ocultas y estados verificables</p></div><b>{loading ? 'Cargando…' : `${connections.length} registradas`}</b></div>
        {!loading && connections.length === 0 ? <div><span className="movement"><i>◇</i><b>Sin conexiones<small>El catálogo está listo para iniciar homologación</small></b></span><em>Vacío</em></div> : connections.map((connection)=><div key={connection.id}><span className="movement"><i>⌘</i><b>{connection.name}<small>{connection.provider} · {connection.environment} · {connection.transport} · {connection.capabilities.join(', ')}</small></b></span><em>{connection.status}</em></div>)}
      </article>
      <article className="review-queue provider-catalog"><div className="card-head"><div><h2>Catálogo homologable</h2><p>Capacidades declaradas desde documentación oficial</p></div><b>{providers.length} proveedores</b></div>
        {providers.map((item)=><div key={item.id}><span className="movement"><i>↗</i><b>{item.name}<small>{item.role} · {item.coverage} · {item.capabilities.join(', ')}</small></b></span><em>Contrato requerido</em></div>)}
      </article>
    </div>
  </div>;
}
