'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Cimbra root render failure', {
      name: error.name,
      digest: error.digest ?? 'unavailable',
    });
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, background: '#f4f1ea', color: '#101b2f', fontFamily: 'Arial, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section role="alert" style={{ width: 'min(620px, 100%)', padding: 'clamp(28px, 6vw, 64px)', background: '#fffefa', border: '1px solid rgba(16,27,47,.16)', borderRadius: 18, boxShadow: '0 26px 70px rgba(16,27,47,.12)' }}>
            <p style={{ color: '#ff6746', fontSize: 12, fontWeight: 750, letterSpacing: '.13em' }}>CIMBRA · RECUPERACIÓN</p>
            <h1 style={{ margin: '22px 0 14px', fontSize: 'clamp(36px, 7vw, 58px)', lineHeight: 1, letterSpacing: '-.05em' }}>El servicio necesita recargarse.</h1>
            <p style={{ color: '#626b76', fontSize: 17, lineHeight: 1.6 }}>No confirmamos ninguna operación desde esta pantalla. Reintentá o regresá al inicio.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 28 }}>
              <button type="button" onClick={reset} style={{ minHeight: 48, padding: '0 20px', border: 0, borderRadius: 8, background: '#101b2f', color: 'white', fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
              <Link href="/" style={{ minHeight: 48, padding: '0 20px', display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(16,27,47,.16)', borderRadius: 8, color: '#101b2f', fontWeight: 700, textDecoration: 'none' }}>Ir al inicio</Link>
            </div>
            {error.digest ? <small style={{ display: 'block', marginTop: 24, color: '#7d8690' }}>Referencia de soporte: {error.digest}</small> : null}
          </section>
        </main>
      </body>
    </html>
  );
}
