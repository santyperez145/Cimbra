import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link className="brand auth-brand" href="/" aria-label="Cimbra, inicio">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>CIMBRA</span>
        </Link>
        <div>
          <p className="eyebrow"><span /> CONSOLA DE INFRAESTRUCTURA</p>
          <h1>Construí y operá<br />finanzas con control.</h1>
          <p>Un entorno seguro para configurar cuentas, pagos, tarjetas, riesgo y compliance desde una sola plataforma.</p>
        </div>
        <ul><li><i /> Sesiones protegidas en servidor</li><li><i /> Datos segregados por organización</li><li><i /> Auditoría de cada operación</li></ul>
      </section>
      <section className="auth-form-panel">
        {children}
        <p className="auth-legal">Al continuar aceptás los <Link href="/terms">Términos</Link> y la <Link href="/privacy">Política de privacidad</Link> de Cimbra.</p>
      </section>
    </main>
  );
}
