'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Cimbra route render failure', {
      name: error.name,
      digest: error.digest ?? 'unavailable',
    });
  }, [error]);

  return (
    <main className="runtime-state-shell">
      <section className="runtime-state-card" role="alert">
        <Link className="brand" href="/" aria-label="Ir al inicio de Cimbra">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>CIMBRA</span>
        </Link>
        <p className="runtime-state-code">ERROR RECUPERABLE</p>
        <h1>No pudimos cargar esta vista.</h1>
        <p>La operación no se confirmó. Podés reintentar de forma segura o volver a la consola.</p>
        <div className="runtime-state-actions">
          <button className="button button-primary" type="button" onClick={reset}>Reintentar <span>↗</span></button>
          <Link className="button button-secondary" href="/console">Volver a la consola</Link>
        </div>
        {error.digest ? <small>Referencia de soporte: {error.digest}</small> : null}
      </section>
    </main>
  );
}
