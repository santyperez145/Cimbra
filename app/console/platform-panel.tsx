'use client';

import { useEffect, useMemo, useState } from 'react';

type Capability = {
  id: string; name: string; domain: string; summary: string; features: string[]; interfaces: string[];
  availability: 'sandbox' | 'foundation' | 'roadmap'; delivery: 'cimbra_native'; regulatoryBoundary: string;
};

const labels = { sandbox: 'Disponible en sandbox', foundation: 'Base técnica', roadmap: 'Roadmap' } as const;

export default function PlatformPanel() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const totals = useMemo(() => ({
    sandbox: capabilities.filter((item) => item.availability === 'sandbox').length,
    foundation: capabilities.filter((item) => item.availability === 'foundation').length,
    roadmap: capabilities.filter((item) => item.availability === 'roadmap').length,
  }), [capabilities]);

  useEffect(() => {
    const task = setTimeout(async () => {
      const response = await fetch('/api/v1/capabilities', { cache: 'no-store' });
      const result = await response.json() as { data?: Capability[]; error?: { message?: string } | string };
      if (!response.ok) {
        setFeedback(typeof result.error === 'string' ? result.error : result.error?.message ?? 'No pudimos cargar la plataforma.');
      } else setCapabilities(result.data ?? []);
      setLoading(false);
    }, 0);
    return () => clearTimeout(task);
  }, []);

  return <div className="module-view">
    <div className="module-view-head"><div><p>CIMBRA SERVICE CLOUD</p><h1>Plataforma financiera propia</h1><span>Core, pagos, tarjetas y operaciones servidos por API, SDK, webhooks y consola.</span></div><span className="module-health"><i /> Cimbra native</span></div>
    {feedback && <div className="form-feedback ledger-feedback">{feedback}</div>}
    <div className="module-metrics"><article><strong>{totals.sandbox}</strong><span>disponibles en sandbox</span></article><article><strong>{totals.foundation}</strong><span>con base técnica</span></article><article><strong>{totals.roadmap}</strong><span>en roadmap</span></article></div>
    <article className="module-list capability-list"><div className="card-head"><div><h2>Catálogo de servicios</h2><p>Producto propio; competidores usados sólo como benchmark</p></div><b>{loading ? 'Cargando…' : `${capabilities.length} dominios`}</b></div>
      {capabilities.map((item) => <div key={item.id}><span className="movement"><i>⌘</i><b>{item.name}<small>{item.summary}</small><small>{item.interfaces.join(' · ')} · {item.features.join(' · ')}</small></b></span><em className={`capability-status ${item.availability}`}>{labels[item.availability]}</em></div>)}
    </article>
    <article className="launch-boundary"><div className="module-icon">✓</div><h2>Límite de lanzamiento</h2><p>Cimbra desarrolla y opera su software. Para mover fondos o conectarse a redes reales se requieren licencias, sponsors o certificaciones directas según el país y el riel. Esa conectividad regulada no convierte a un competidor en dependencia tecnológica.</p></article>
  </div>;
}
