import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="runtime-state-shell">
      <section className="runtime-state-card">
        <Link className="brand" href="/" aria-label="Ir al inicio de Cimbra">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>CIMBRA</span>
        </Link>
        <p className="runtime-state-code">404 · RUTA NO ENCONTRADA</p>
        <h1>Esta dirección no existe.</h1>
        <p>Verificá el enlace o continuá desde una superficie vigente de la plataforma.</p>
        <div className="runtime-state-actions">
          <Link className="button button-primary" href="/console">Abrir consola <span>↗</span></Link>
          <Link className="button button-secondary" href="/developers">Ver documentación</Link>
        </div>
      </section>
    </main>
  );
}
