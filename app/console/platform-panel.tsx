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
  status: 'unwired' | 'negotiating' | 'contracted' | 'certified' | 'live'; adapterRegistered: boolean; productIds: string[];
  evidence?: {
    counterpartyLegalName: string; contractReference: string; safeguardingAccountRef: string;
  };
  dueDiligenceRequiredMet?: boolean;
};

type FintechPath = {
  intendedFigure: string; summary: string; metCount: number; gateCount: number;
  officialSources: Array<{ name: string; url: string; surface: string }>;
  gates: Array<{ id: string; name: string; summary: string; status: Rail['status']; met: boolean }>;
};

type CapitalPlan = {
  envelope: number; allocated: number; remaining: number; spent: number; commercialGate: string; liveReadyAfterSpend: boolean; summary: string;
  allocations: Array<{ id: string; amount: number; status: string; name: string; summary: string }>;
  forbidden: Array<{ id: string; name: string; summary: string }>;
  seedUses: string[];
  raise: { instrument: string; amountUsd: number | null; thesis: string };
};

type ServiceTopology = {
  services: Array<{
    id: string; name: string; mission: string; runtime: 'in_process' | 'standalone'; ownedTables: number;
    modules: number; extractable: boolean; extractionGate: string;
    extractionDebt: Array<{ table: string; owner: string; reason: string }>;
  }>;
  totals: { services: number; standalone: number; extractable: number; ownedTables: number; extractionDebt: number };
  posture: string;
};

type Readiness = {
  effectiveMode: 'sandbox' | 'live'; liveReady: boolean; liveBlocked: boolean; blockReason: string | null;
  goLive: { benchmark: string; documentationUrl: string; current: string; stages: Array<{ id: string; name: string; summary: string }> };
  environments: Environment[];
  products: Product[];
  rails: Rail[];
  fintechPath: FintechPath;
  capitalPlan: CapitalPlan;
  summary: { integracion: number; homologacion: number; goLive: number; officialRailsLive: number; officialRailsTotal: number };
};

const labels = {
  live: 'Productiva', sandbox: 'Contrato ejecutable', foundation: 'Base técnica', roadmap: 'Roadmap',
} as const;

const productLabels = {
  integracion: 'Integración', homologacion: 'Homologación', go_live: 'Go Live',
} as const;

const railLabels = {
  unwired: 'Sin cablear', negotiating: 'Negociando', contracted: 'Contrato', certified: 'Certificado', live: 'Live',
} as const;

const railStatusClass = {
  unwired: 'roadmap', negotiating: 'foundation', contracted: 'foundation', certified: 'sandbox', live: 'live',
} as const;

export default function PlatformPanel() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [topology, setTopology] = useState<ServiceTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const totals = useMemo(() => ({
    sandbox: capabilities.filter((item) => item.availability === 'sandbox').length,
    live: capabilities.filter((item) => item.availability === 'live').length,
  }), [capabilities]);

  useEffect(() => {
    const task = setTimeout(async () => {
      const [catalogResponse, readinessResponse, servicesResponse] = await Promise.all([
        authenticatedFetch('/api/v1/capabilities', { cache: 'no-store' }),
        authenticatedFetch('/api/v1/live-readiness', { cache: 'no-store' }),
        authenticatedFetch('/api/v1/services', { cache: 'no-store' }),
      ]);
      const services = await servicesResponse.json() as { data?: ServiceTopology };
      if (servicesResponse.ok) setTopology(services.data ?? null);
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
      <article><strong>{readiness?.capitalPlan ? `USD ${readiness.capitalPlan.envelope}` : '—'}</strong><span>presupuesto Gate 1</span></article>
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
    <article className="module-list capability-list"><div className="card-head"><div><h2>Presupuesto Gate 1 (USD 500)</h2><p>{readiness?.capitalPlan?.summary ?? 'Envelope comercial para design partners, consulta legal, dominio y correo. No compra riel ni Go Live.'} Data room público: <a href="/investors">/investors</a>.</p></div><b>{readiness?.capitalPlan ? `USD ${readiness.capitalPlan.spent} gastados` : 'Cargando…'}</b></div>
      {(readiness?.capitalPlan?.allocations ?? []).map((item) => <div key={item.id}><span className="movement"><i>{item.status === 'spent' ? '✓' : '○'}</i><b>{item.name}<small>USD {item.amount} · {item.status === 'spent' ? 'gastado' : 'autorizado, no gastado'}</small><small>{item.summary}</small></b></span><em className={`capability-status ${item.status === 'spent' ? 'sandbox' : 'foundation'}`}>{item.status === 'spent' ? 'Gastado' : 'Sin gastar'}</em></div>)}
      {(readiness?.capitalPlan?.forbidden ?? []).map((item) => <div key={item.id}><span className="movement"><i>○</i><b>{item.name}<small>{item.summary}</small></b></span><em className="capability-status roadmap">Prohibido</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Rieles oficiales listos para cablear</h2><p>BCRA, Coelsa, banco patrocinante, PCI y originadores. El estado se persiste para cuando exista contrato y certificación; el adaptador Cimbra se registra fuera del ledger. Ningún competidor aparece como contraparte.</p></div><b>{loading ? 'Cargando…' : `${readiness?.summary.officialRailsLive ?? 0}/${readiness?.summary.officialRailsTotal ?? 0} live`}</b></div>
      {(readiness?.rails ?? []).map((rail) => <div key={rail.id}><span className="movement"><i>{rail.status === 'live' && rail.adapterRegistered ? '✓' : '○'}</i><b>{rail.name}<small>{rail.counterparty}{rail.evidence?.counterpartyLegalName ? ` · ${rail.evidence.counterpartyLegalName}` : ''} · <a href={rail.officialUrl} target="_blank" rel="noreferrer">fuente oficial</a></small><small>{rail.summary}</small><small>Puerto: {rail.wiringContract}{rail.adapterRegistered ? ' · adaptador registrado' : ' · sin adaptador'}{rail.id === 'sponsor_bank' ? (rail.dueDiligenceRequiredMet ? ' · DD sponsor completo' : ' · DD sponsor pendiente') : ''}</small></b></span><em className={`capability-status ${railStatusClass[rail.status]}`}>{railLabels[rail.status]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Productos del catálogo público</h2><p>Nombres y cobertura tomados de BIND APIBANK, BIND PSP, Pomelo Issuing y tapi. Homologan por separado; cada uno declara los rieles oficiales que faltan. Dock documenta Pix y tarjetas en Brasil: no hay producto AR inventado. Wibond no publica un contrato de riel usable.</p></div><b>{loading ? 'Cargando…' : `${readiness?.summary.integracion ?? 0} en integración`}</b></div>
      {(readiness?.products ?? []).map((product) => <div key={product.id}><span className="movement"><i>⌁</i><b>{product.name}<small>{product.benchmark} · {product.network}</small><small>Sandbox: {product.sandboxCoverage}</small><small>Falta: {product.missingForProduction}</small><small>Rieles: {product.requiredRailIds.join(', ') || 'ninguno'}{product.missingOfficialRails.length ? ` · sin live: ${product.missingOfficialRails.join(', ')}` : ''}{product.adapterReady ? ' · adaptador listo' : ' · sin adaptador'}</small></b></span><em className={`capability-status ${product.status === 'go_live' ? 'live' : product.status === 'homologacion' ? 'sandbox' : 'roadmap'}`}>{productLabels[product.status]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Catálogo de servicios Cimbra</h2><p>Producto propio; competidores usados sólo como benchmark</p></div><b>{loading ? 'Cargando…' : `${capabilities.length} dominios`}</b></div>
      {capabilities.map((item) => <div key={item.id}><span className="movement"><i>⌘</i><b>{item.name}<small>{item.summary}</small><small>{item.interfaces.join(' · ')} · {item.features.join(' · ')}</small></b></span><em className={`capability-status ${item.availability}`}>{labels[item.availability]}</em></div>)}
    </article>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Arquitectura de servicios</h2><p>{topology?.posture ?? 'Cada tabla y cada módulo de datos pertenece a un servicio de dominio verificado por tests de frontera.'}</p></div><b>{topology ? `${topology.totals.extractable}/${topology.totals.services} extraíbles` : 'Cargando…'}</b></div>
      {(topology?.services ?? []).map((service) => <div key={service.id}><span className="movement"><i>{service.extractable ? '✓' : '○'}</i><b>{service.name}<small>{service.mission}</small><small>{service.ownedTables} tablas propias · {service.modules} módulos · runtime {service.runtime === 'in_process' ? 'compartido' : 'propio'}</small><small>Compuerta: {service.extractionGate}</small>{service.extractionDebt.length > 0 && <small>Deuda: {service.extractionDebt.map((debt) => `${debt.table} (${debt.owner})`).join(', ')}</small>}</b></span><em className={`capability-status ${service.extractable ? 'sandbox' : 'foundation'}`}>{service.extractable ? 'Extraíble' : `${service.extractionDebt.length} cruces`}</em></div>)}
    </article>
    <article className="launch-boundary"><div className="module-icon">✓</div><h2>Límite de lanzamiento</h2><p>No hay hostname de producción, producto en Go Live, riel oficial live ni adaptador de cámara. El envelope de USD 500 no autoriza AWS pago ni marca Go Live. Hasta entonces no hay claves <code>cim_sk_live_</code> ni movimiento de fondos. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.</p></article>
  </div>;
}
