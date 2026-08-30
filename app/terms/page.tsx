import Link from 'next/link';

export const metadata = {
  title: 'Términos del sandbox — Cimbra',
  description: 'Condiciones de uso del entorno tecnológico sandbox de Cimbra.',
};

export default function TermsPage() {
  return <main className="legal-shell">
    <header><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link><Link href="/login">Volver al acceso →</Link></header>
    <article>
      <p className="eyebrow"><span /> LEGAL · SANDBOX</p>
      <h1>Términos de uso</h1>
      <p className="legal-updated">Última actualización: 30 de agosto de 2026</p>
      <section><h2>1. Alcance</h2><p>Cimbra ofrece actualmente un entorno tecnológico de prueba para evaluar identidad, orquestación KYC/KYB, recursos financieros sandbox, ledger, transferencias simuladas, tarjetas de prueba, catálogos de servicios, obligaciones, pagos, recargas y mandatos recurrentes, y evidencia documental. El sandbox no consulta empresas de servicios externas, no ofrece cobertura comercial o débito automático homologado, no abre cuentas bancarias, no emite tarjetas en redes reales, no presta dinero, no mueve fondos y no reemplaza verificaciones, consentimientos exigibles, listas, registros ni aprobaciones regulatorias oficiales.</p></section>
      <section><h2>2. Uso permitido</h2><p>Podés usar el sandbox para desarrollo, evaluación e integración. No debés presentar sus recursos como productos financieros activos ni cargar datos de tarjetas, credenciales bancarias o información personal sensible de terceros sin una base legal y autorización adecuadas.</p></section>
      <section><h2>3. Cuenta y seguridad</h2><p>Sos responsable de mantener confidenciales tus credenciales, usar información exacta y notificarnos cualquier acceso no autorizado. Cimbra puede limitar intentos, revocar sesiones o suspender cuentas ante abuso o riesgo para la plataforma.</p></section>
      <section><h2>4. Disponibilidad</h2><p>El sandbox se entrega para evaluación y no tiene un SLA contractual. Podemos actualizar endpoints o datos semilla; los cambios incompatibles se documentarán en el contrato OpenAPI versionado.</p></section>
      <section><h2>5. Propiedad y datos</h2><p>Cimbra conserva la propiedad del software, marca y documentación. Vos conservás los derechos sobre los datos que cargás y nos autorizás a procesarlos únicamente para operar, asegurar y mejorar el sandbox según la Política de privacidad.</p></section>
      <section><h2>6. Responsabilidad</h2><p>No uses el sandbox para decisiones financieras, regulatorias o crediticias reales. En la medida permitida por la ley, Cimbra no responde por pérdidas derivadas de tratar resultados simulados como operaciones productivas.</p></section>
      <section><h2>7. Contacto y cambios</h2><p>Para consultas, baja o ejercicio de derechos, usá el <Link href="/#demo">formulario de contacto</Link>. Si estos términos cambian materialmente, se actualizará la fecha publicada antes de exigir la nueva versión.</p></section>
    </article>
  </main>;
}
