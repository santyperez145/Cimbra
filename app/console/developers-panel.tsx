'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch } from '@/app/lib/platform/client-http';
import { API_SCOPES } from '@/app/lib/platform/scopes';
import { WEBHOOK_EVENT_TYPES } from '@/app/lib/platform/webhook-events';

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; status: string; rateLimitPerMinute: number; lastUsedAt: string | null; expiresAt: string | null; createdAt: string };
type Endpoint = { id: string; name: string; url: string; eventTypes: string[]; status: string; secretRotatedAt: string; createdAt: string };
type Delivery = { id: string; endpointId: string; eventType: string; status: string; attemptCount: number; responseStatus: number | null; lastError: string | null; createdAt: string };

export default function DevelopersPanel({ journalCount }: { journalCount: number }) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [keyResponse, webhookResponse] = await Promise.all([
      authenticatedFetch('/api/platform/api-keys', { cache: 'no-store' }),
      authenticatedFetch('/api/platform/webhooks', { cache: 'no-store' }),
    ]);
    if (keyResponse.ok) setApiKeys(((await keyResponse.json()) as { data: ApiKey[] }).data);
    if (webhookResponse.ok) {
      const result = (await webhookResponse.json()) as { data: { endpoints: Endpoint[]; deliveries: Delivery[] } };
      setEndpoints(result.data.endpoints); setDeliveries(result.data.deliveries);
    }
  }

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const selectedScopes = API_SCOPES.filter((scope) => form.getAll('scopes').includes(scope));
    const response = await authenticatedFetch('/api/platform/api-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), scopes: selectedScopes, expiresInDays: Number(form.get('expiresInDays')) }),
    });
    const result = await response.json() as { error?: string; secret?: string };
    if (response.ok && result.secret) {
      setSecret({ title: 'API key creada', value: result.secret });
      setFeedback('Guardala ahora: Cimbra no puede volver a mostrarla.'); event.currentTarget.reset(); await load();
    } else setFeedback(result.error ?? 'No se pudo crear la API key.');
    setBusy(false);
  }

  async function keyAction(id: string, action: 'revoke' | 'rotate') {
    if (action === 'revoke' && !window.confirm('¿Revocar esta API key ahora? La acción es inmediata.')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/api-keys/${id}${action === 'rotate' ? '/rotate' : ''}`, { method: action === 'rotate' ? 'POST' : 'DELETE' });
    const result = await response.json() as { error?: string; secret?: string };
    if (response.ok) {
      if (result.secret) setSecret({ title: 'API key rotada', value: result.secret });
      setFeedback(action === 'rotate' ? 'La clave anterior fue revocada y la nueva ya está activa.' : 'API key revocada.'); await load();
    } else setFeedback(result.error ?? 'No se pudo completar la operación.');
    setBusy(false);
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback('');
    const form = new FormData(event.currentTarget);
    const selectedEvents = WEBHOOK_EVENT_TYPES.filter((type) => form.getAll('eventTypes').includes(type));
    const response = await authenticatedFetch('/api/platform/webhooks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), url: form.get('url'), eventTypes: selectedEvents }),
    });
    const result = await response.json() as { error?: string; secret?: string };
    if (response.ok && result.secret) {
      setSecret({ title: 'Signing secret creado', value: result.secret });
      setFeedback('Guardalo para verificar Cimbra-Signature. No volverá a mostrarse.'); event.currentTarget.reset(); await load();
    } else setFeedback(result.error ?? 'No se pudo crear el webhook.');
    setBusy(false);
  }

  async function webhookAction(id: string, action: 'disable' | 'rotate') {
    if (action === 'disable' && !window.confirm('¿Deshabilitar este endpoint y cancelar sus entregas pendientes?')) return;
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/webhooks/${id}${action === 'rotate' ? '/rotate' : ''}`, { method: action === 'rotate' ? 'POST' : 'DELETE' });
    const result = await response.json() as { error?: string; secret?: string };
    if (response.ok) {
      if (result.secret) setSecret({ title: 'Signing secret rotado', value: result.secret });
      setFeedback(action === 'rotate' ? 'El signing secret fue rotado.' : 'Webhook deshabilitado.'); await load();
    } else setFeedback(result.error ?? 'No se pudo completar la operación.');
    setBusy(false);
  }

  async function replay(id: string) {
    setBusy(true); setFeedback('');
    const response = await authenticatedFetch(`/api/platform/webhooks/deliveries/${id}/replay`, { method: 'POST' });
    const result = await response.json() as { error?: string };
    setFeedback(response.ok ? 'Entrega reencolada; el intento se ejecuta en segundo plano.' : result.error ?? 'No se pudo reintentar.');
    await load(); setBusy(false);
  }

  return <div className="module-view developer-console">
    <div className="module-view-head"><div><p>PLATFORM INTEGRATION</p><h1>API y webhooks</h1><span>Credenciales S2S con scopes y eventos firmados, persistidos y reintentables.</span></div><span className="module-health"><i /> v2026-08-30</span></div>
    <div className="module-metrics"><article><strong>{apiKeys.filter((key) => key.status === 'active').length}</strong><span>API keys activas</span></article><article><strong>{endpoints.filter((endpoint) => endpoint.status === 'active').length}</strong><span>endpoints activos</span></article><article><strong>{journalCount}</strong><span>journals del tenant</span></article></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    {secret && <aside className="secret-reveal"><div><strong>{secret.title}</strong><span>Se muestra una sola vez.</span></div><code>{secret.value}</code><button onClick={() => void navigator.clipboard.writeText(secret.value)}>Copiar</button><button onClick={() => setSecret(null)}>Cerrar</button></aside>}

    <div className="integration-grid">
      <article className="integration-card"><div className="card-head"><div><h2>API keys</h2><p>Bearer tokens almacenados como hash</p></div><Link href="/developers">OpenAPI →</Link></div>
        <form className="integration-form" onSubmit={createKey}><div className="integration-fields"><label>Nombre<input name="name" placeholder="Backend producción" minLength={2} required /></label><label>Vence en<select name="expiresInDays" defaultValue="90"><option value="30">30 días</option><option value="90">90 días</option><option value="180">180 días</option><option value="365">365 días</option></select></label></div><fieldset><legend>Scopes</legend>{API_SCOPES.map((scope) => <label key={scope}><input type="checkbox" name="scopes" value={scope} defaultChecked={['transfers:read', 'transfers:write', 'ledger:read'].includes(scope)} />{scope}</label>)}</fieldset><button disabled={busy}>Crear API key</button></form>
        <div className="integration-list">{apiKeys.length === 0 ? <p>Sin API keys creadas.</p> : apiKeys.map((key) => <div key={key.id}><span><strong>{key.name}</strong><small>cim_sk_test_{key.prefix}_•••• · {key.rateLimitPerMinute}/min · {key.scopes.join(', ')}</small></span><b className={key.status}>{key.status}</b>{key.status === 'active' && <span className="integration-actions"><button disabled={busy} onClick={() => void keyAction(key.id, 'rotate')}>Rotar</button><button disabled={busy} onClick={() => void keyAction(key.id, 'revoke')}>Revocar</button></span>}</div>)}</div>
      </article>

      <article className="integration-card"><div className="card-head"><div><h2>Webhooks</h2><p>HTTPS + HMAC-SHA256 + timestamp</p></div><b>OUTBOX</b></div>
        <form className="integration-form" onSubmit={createWebhook}><div className="integration-fields"><label>Nombre<input name="name" placeholder="Eventos backend" minLength={2} required /></label><label>URL HTTPS<input name="url" type="url" placeholder="https://api.empresa.com/cimbra" required /></label></div><fieldset><legend>Eventos</legend>{WEBHOOK_EVENT_TYPES.map((type) => <label key={type}><input type="checkbox" name="eventTypes" value={type} defaultChecked={type.startsWith('transfer.')} />{type}</label>)}</fieldset><button disabled={busy}>Crear webhook</button></form>
        <div className="integration-list">{endpoints.length === 0 ? <p>Sin endpoints configurados.</p> : endpoints.map((endpoint) => <div key={endpoint.id}><span><strong>{endpoint.name}</strong><small>{endpoint.url} · {endpoint.eventTypes.join(', ')}</small></span><b className={endpoint.status}>{endpoint.status}</b>{endpoint.status === 'active' && <span className="integration-actions"><button disabled={busy} onClick={() => void webhookAction(endpoint.id, 'rotate')}>Rotar secret</button><button disabled={busy} onClick={() => void webhookAction(endpoint.id, 'disable')}>Deshabilitar</button></span>}</div>)}</div>
      </article>
    </div>

    <article className="module-list delivery-list"><div className="card-head"><div><h2>Entregas recientes</h2><p>Estado durable e historial de intentos</p></div><button onClick={() => void load()}>Actualizar</button></div>{deliveries.length === 0 ? <div><span className="movement"><i>◇</i><b>Sin entregas<small>Se crearán al emitir un evento suscripto</small></b></span><strong>Vacío</strong></div> : deliveries.slice(0, 20).map((delivery) => <div key={delivery.id}><span className="movement"><i>{delivery.status === 'delivered' ? '✓' : '!'}</i><b>{delivery.eventType}<small>{new Date(delivery.createdAt).toLocaleString('es-AR')} · {delivery.attemptCount} intento(s){delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}</small></b></span><strong>{delivery.status}</strong>{['retry', 'exhausted'].includes(delivery.status) && <button disabled={busy} onClick={() => void replay(delivery.id)}>Replay</button>}</div>)}</article>
  </div>;
}
