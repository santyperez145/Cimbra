'use client';

import { useEffect, useState } from 'react';

type Health = {
  status?: string;
  version?: string;
  latencyMs?: number;
  dependencies?: { database?: string };
};

export default function PlatformStatus() {
  const [state, setState] = useState<'checking' | 'operational' | 'degraded'>('checking');
  const [detail, setDetail] = useState('Verificando API');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/health', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const health = await response.json() as Health;
        if (!response.ok || health.status !== 'ok' || health.dependencies?.database !== 'ok') throw new Error('degraded');
        setState('operational');
        setDetail(`API y DB operativas${typeof health.latencyMs === 'number' ? ` · ${health.latencyMs} ms` : ''}`);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState('degraded');
        setDetail('Estado no disponible');
      });
    return () => controller.abort();
  }, []);

  return <a className={`docs-live-status ${state}`} href="/api/health" aria-label={`Estado de plataforma: ${detail}`}>
    <i /> {detail}
  </a>;
}
