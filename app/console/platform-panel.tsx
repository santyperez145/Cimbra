'use client';

import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/app/lib/platform/client-http';

type Capability = {
  id: string; name: string; domain: string; summary: string; features: string[]; interfaces: string[];
  availability: 'live' | 'sandbox' | 'foundation' | 'roadmap'; delivery: 'cimbra_native'; regulatoryBoundary: string;
};

type Product = {
  id: string; name: string; country: string; benchmark: string; documentationUrl: string; network: string;
  sandboxCoverage: string; missingForProduction: string; status: 'integracion' | 'homologacion' | 'go_live';
  requiredRailIds: string[]; missingOfficialRails: string[]; adapterReady: boolean;
};

type Environment = {
  id: 'sandbox' | 'production'; status: 'active' | 'provisioned' | 'not_provisioned';
  hostname: string | null; pciHostname: string | null; credentialsPrefix: string; benchmark: string;
};

type Rail = {
  id: string; name: string; counterparty: string; officialUrl: string; summary: string; wiringContract: string;
  status: 'unwired' | 'contracted' | 'certified' | 'live'; adapterRegistered: boolean; productIds: string[];
};

type FintechPath = {
  intendedFigure: string; summary: string; metCount: number; gateCount: number;
  officialSources: Array<{ name: string; url: string; surface: string }>;
  gates: Array<{ id: string; name: string; summary: string; status: Rail['status']; met: boolean }>;
};

type Readiness = {
  effectiveMode: 'sandbox' | 'live'; liveReady: boolean; liveBlocked: boolean; blockReason: string | null;
  goLive: { benchmark: string; documentationUrl: string; current: string; stages: Array<{ id: string; name: string; summary: string }> };
  environments: Environment[];
  products: Product[];
  rails: Rail[];
  fintechPath: FintechPath;
  summary: { integracion: number; homologacion: number; goLive: number; officialRailsLive: number; officialRailsTotal: number };
};

const labels = {
  live: 'Productiva', sandbox: 'Contrato ejecutable', foundation: 'Base técnica', roadmap: 'Roadmap',
} as const;

const productLabels = {
  integracion: 'Integración', homologacion: 'Homologación', go_live: 'Go Live',
} as const;

const railLabels = {
  unwired: 'Sin cablear', contracted: 'Contrato', certified: 'Certificado', live: 'Live',
} as const;

const railStatusClass = {
  unwired: 'roadmap', contracted: 'foundation', certified: 'sandbox', live: 'live',
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
    <div className="module-view-head"><div><p>CIMBRA SERVICE CLOUD</p><h1>Plataforma financiera propia</h1><span>Sandbox activo. Production, rieles oficiales y aprobación PSPCP siguen fail-closed hasta hostname, inscripción BCRA, banco patrocinante, Coelsa y adaptador Cimbra. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.</span></div><span className="module-health"><i /> {readiness?.effectiveMode === 'live' ? 'Live' : 'Entorno sandbox'}</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics">
      <article><strong>{readiness?.liveReady ? 'Sí' : 'No'}</strong><span>listo para dinero real</span></article>
      <article><strong>{readiness?.environments.find((item) => item.id === 'production')?.hostname ?? 'sin hostname'}</strong><span>production</span></article>
      <article><strong>{readiness?.summary.goLive ?? 0}</strong><span>productos en Go Live</span></article>
      <article><strong>{readiness?.fintechPath ? `${readiness.fintechPath.metCount}/${readiness.fintechPath.gateCount}` : '0/0'}</strong><span>gates fintech AR</span></article>
      <article><strong>{totals.sandbox}</strong><span>contratos ejecutables</span></article>
      <article><strong>{totals.live}</strong><span>declaradas live</span></article>
    </div>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Entornos</h2><p>Pismo separa sandbox.pismolabs.io de un hostname de producción y un hostname PCI. Pomelo usa sandbox.api.pomelo.la y api.pomelo.la. BIND APIBANK publica sandbox; production es onboarding comercial.</p></div><b>{readiness?.liveReady ? 'LIVE READY' : 'FAIL CLOSED'}</b></div>
      {(readiness?.environments ?? []).map((environment) => <div key={environment.id}><span className="movement"><i>{environment.status === 'active' || environment.status === 'provisioned' ? '✓' : '○'}</i><b>{environment.id}<small>{environment.hostname ?? 'Hostname no provisionado'}{environment.pciHostname ? ` · PCI ${environment.pciHostname}` : ' · sin hostname PCI'} · {environment.credentialsPrefix}*</small><small>{environment.benchmark}</small></b></span><em className={`capability-status ${environment.status === 'not_provisioned' ? 'roadmap' : 'sandbox'}`}>{environment.status === 'not_provisioned' ? 'No provisionado' : environment.status === 'provisioned' ? 'Provisionado' : 'Activo'}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Go Live</h2><p><a href={readiness?.goLive.documentationUrl ?? 'https://docs.pomelo.la/docs/get-started/home'} target="_blank" rel="noreferrer">Pomelo documenta Integración, Homologación y Go Live</a>. Cimbra está en Integración: documentación y sandbox, sin homologación comercial ni riel oficial live.</p></div><b>{productLabels[readiness?.goLive.current as keyof typeof productLabels] ?? 'Integración'}</b></div>
      {(readiness?.goLive.stages ?? []).map((stage) => <div key={stage.id}><span className="movement"><i>{readiness?.goLive.current === stage.id ? '●' : '○'}</i><b>{stage.name}<small>{stage.summary}</small></b></span><em className={`capability-status ${readiness?.goLive.current === stage.id ? 'sandbox' : 'roadmap'}`}>{readiness?.goLive.current === stage.id ? 'Actual' : 'Pendiente'}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Camino de aprobación fintech (PSPCP Argentina)</h2><p>{readiness?.fintechPath.summary ?? 'Gates públicos del BCRA para operar cuentas de pago. No hay inscripción ni cableado.'} {(readiness?.fintechPath.officialSources ?? []).map((source, index) => <span key={source.url}>{index > 0 ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)}</p></div><b>{readiness?.fintechPath ? `${readiness.fintechPath.metCount} de ${readiness.fintechPath.gateCount}` : 'Cargando…'}</b></div>
      {(readiness?.fintechPath.gates ?? []).map((gate) => <div key={gate.id}><span className="movement"><i>{gate.met ? '✓' : '○'}</i><b>{gate.name}<small>{gate.summary}</small></b></span><em className={`capability-status ${railStatusClass[gate.status]}`}>{railLabels[gate.status]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Rieles oficiales listos para cablear</h2><p>BCRA, Coelsa, banco patrocinante, PCI y originadores. El estado se persiste para cuando exista contrato y certificación; el adaptador Cimbra se registra fuera del ledger. Ningún competidor aparece como contraparte.</p></div><b>{loading ? 'Cargando…' : `${readiness?.summary.officialRailsLive ?? 0}/${readiness?.summary.officialRailsTotal ?? 0} live`}</b></div>
      {(readiness?.rails ?? []).map((rail) => <div key={rail.id}><span className="movement"><i>{rail.status === 'live' && rail.adapterRegistered ? '✓' : '○'}</i><b>{rail.name}<small>{rail.counterparty} · <a href={rail.officialUrl} target="_blank" rel="noreferrer">fuente oficial</a></small><small>{rail.summary}</small><small>Puerto: {rail.wiringContract}{rail.adapterRegistered ? ' · adaptador registrado' : ' · sin adaptador'}</small></b></span><em className={`capability-status ${railStatusClass[rail.status]}`}>{railLabels[rail.status]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Productos del catálogo público</h2><p>Nombres y cobertura tomados de BIND APIBANK, BIND PSP, Pomelo Issuing y tapi. Homologan por separado; cada uno declara los rieles oficiales que faltan. Dock documenta Pix y tarjetas en Brasil: no hay producto AR inventado. Wibond no publica un contrato de riel usable.</p></div><b>{loading ? 'Cargando…' : `${readiness?.summary.integracion ?? 0} en integración`}</b></div>
      {(readiness?.products ?? []).map((product) => <div key={product.id}><span className="movement"><i>⌁</i><b>{product.name}<small>{product.benchmark} · {product.network}</small><small>Sandbox: {product.sandboxCoverage}</small><small>Falta: {product.missingForProduction}</small><small>Rieles: {product.requiredRailIds.join(', ') || 'ninguno'}{product.missingOfficialRails.length ? ` · sin live: ${product.missingOfficialRails.join(', ')}` : ''}{product.adapterReady ? ' · adaptador listo' : ' · sin adaptador'}</small></b></span><em className={`capability-status ${product.status === 'go_live' ? 'live' : product.status === 'homologacion' ? 'sandbox' : 'roadmap'}`}>{productLabels[product.status]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Catálogo de servicios Cimbra</h2><p>Producto propio; competidores usados sólo como benchmark</p></div><b>{loading ? 'Cargando…' : `${capabilities.length} dominios`}</b></div>
      {capabilities.map((item) => <div key={item.id}><span className="movement"><i>⌘</i><b>{item.name}<small>{item.summary}</small><small>{item.interfaces.join(' · ')} · {item.features.join(' · ')}</small></b></span><em className={`capability-status ${item.availability}`}>{labels[item.availability]}</em></div>)}
    </article>
    <article className="launch-boundary"><div className="module-icon">✓</div><h2>Límite de lanzamiento</h2><p>No hay hostname de producción, producto en Go Live, riel oficial live ni adaptador de cámara. Marcar un producto como Go Live en base no habilita dinero: faltan inscripción PSP, sponsor, Coelsa y el adaptador Cimbra. Hasta entonces no hay claves <code>cim_sk_live_</code> ni movimiento de fondos. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.</p></article>
  </div>;
}
