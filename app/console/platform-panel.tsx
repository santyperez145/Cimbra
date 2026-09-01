'use client';

import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Capability = {
  id: string; name: string; domain: string; summary: string; features: string[]; interfaces: string[];
  availability: 'live' | 'sandbox' | 'foundation' | 'roadmap'; delivery: 'cimbra_native'; regulatoryBoundary: string;
};

type Gate = { id: string; name: string; kind: string; requiredForLive: boolean; status: 'ready' | 'missing'; summary: string };
type Rail = { id: string; country: string; kind: string; counterparty: string; requiredForLiveMoney: boolean; status: string };

type Readiness = {
  effectiveMode: 'sandbox' | 'live'; liveReady: boolean; liveBlocked: boolean; blockReason: string | null;
  gates: Gate[]; rails: Rail[];
  summary: { readyGates: number; missingGates: number; disconnectedRails: number; certifiedRails: number };
};

const labels = {
  live: 'Productiva', sandbox: 'Contrato ejecutable', foundation: 'Base técnica', roadmap: 'Roadmap',
} as const;

export default function PlatformPanel() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const totals = useMemo(() => ({
    sandbox: capabilities.filter((item) => item.availability === 'sandbox').length,
    live: capabilities.filter((item) => item.availability === 'live').length,
  }), [capabilities]);

  useEffect(() => {
    const task = setTimeout(async () => {
      const [catalogResponse, readinessResponse] = await Promise.all([
        authenticatedFetch('/api/v1/capabilities', { cache: 'no-store' }),
        authenticatedFetch('/api/v1/live-readiness', { cache: 'no-store' }),
      ]);
      const catalog = await catalogResponse.json() as { data?: Capability[]; error?: { message?: string } | string };
      const live = await readinessResponse.json() as { data?: Readiness; error?: { message?: string } | string };
      if (!catalogResponse.ok) {
        setFeedback(typeof catalog.error === 'string' ? catalog.error : catalog.error?.message ?? 'No pudimos cargar la plataforma.');
      } else setCapabilities(catalog.data ?? []);
      if (!readinessResponse.ok) {
        setFeedback(typeof live.error === 'string' ? live.error : live.error?.message ?? 'No pudimos cargar el readiness live.');
      } else setReadiness(live.data ?? null);
      setLoading(false);
    }, 0);
    return () => clearTimeout(task);
  }, []);

  return <div className="module-view">
    <div className="module-view-head"><div><p>CIMBRA SERVICE CLOUD</p><h1>Plataforma financiera propia</h1><span>El contrato es el producto real. El entorno actual es sandbox hasta que los gates live y un riel directo certificado se cumplan.</span></div><span className="module-health"><i /> {readiness?.effectiveMode === 'live' ? 'Live' : 'Entorno sandbox'}</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{readiness?.liveReady ? 'Sí' : 'No'}</strong><span>listo para dinero real</span></article>
      <article><strong>{readiness?.summary.readyGates ?? '—'}</strong><span>gates de software listos</span></article>
      <article><strong>{readiness?.summary.missingGates ?? '—'}</strong><span>gates de evidencia pendientes</span></article>
      <article><strong>{totals.sandbox}</strong><span>contratos ejecutables</span></article>
      <article><strong>{totals.live}</strong><span>declaradas live</span></article>
    </div>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Gates de salida a live</h2><p>Flip de entorno, no reescritura de API. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son rieles.</p></div><b>{loading ? 'Cargando…' : readiness?.liveReady ? 'LIVE READY' : 'FAIL CLOSED'}</b></div>
      {(readiness?.gates ?? []).map((gate) => <div key={gate.id}><span className="movement"><i>{gate.status === 'ready' ? '✓' : '○'}</i><b>{gate.name}<small>{gate.summary}</small></b></span><em className={`capability-status ${gate.status === 'ready' ? 'sandbox' : 'roadmap'}`}>{gate.status === 'ready' ? 'Listo' : 'Falta evidencia'}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Puertos de riel nativos</h2><p>Sólo bancos, cámaras, esquemas, registros oficiales o sponsors regulados</p></div><b>{readiness?.summary.disconnectedRails ?? 0} desconectados</b></div>
      {(readiness?.rails ?? []).map((rail) => <div key={rail.id}><span className="movement"><i>⌁</i><b>{rail.counterparty}<small>{rail.country} · {rail.kind}{rail.requiredForLiveMoney ? ' · requerido para dinero' : ''}</small></b></span><em className={`capability-status ${rail.status === 'disconnected' ? 'roadmap' : 'sandbox'}`}>{rail.status}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Catálogo de servicios</h2><p>Producto propio; competidores usados sólo como benchmark</p></div><b>{loading ? 'Cargando…' : `${capabilities.length} dominios`}</b></div>
      {capabilities.map((item) => <div key={item.id}><span className="movement"><i>⌘</i><b>{item.name}<small>{item.summary}</small><small>{item.interfaces.join(' · ')} · {item.features.join(' · ')}</small></b></span><em className={`capability-status ${item.availability}`}>{labels[item.availability]}</em></div>)}
    </article>
    <article className="launch-boundary"><div className="module-icon">✓</div><h2>Límite de lanzamiento</h2><p>El software ya es el núcleo de producción. Graduar a live exige licencia o sponsor, riel directo homologado, safeguarding, conciliación de tres vías, pentest cerrado, SLO y runbooks. Hasta entonces no hay URL live, ni claves <code>cim_sk_live_</code>, ni movimiento de fondos. Esa conectividad regulada no convierte a un competidor en dependencia tecnológica.</p></article>
  </div>;
}
