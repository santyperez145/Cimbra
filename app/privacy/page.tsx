import Link from 'next/link';

export const metadata = {
  title: 'Privacidad — Cimbra',
  description: 'Política de privacidad del entorno tecnológico sandbox de Cimbra.',
};

export default function PrivacyPage() {
  return <main className="legal-shell">
    <header><Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link><Link href="/login">Volver al acceso →</Link></header>
    <article>
      <p className="eyebrow"><span /> PRIVACIDAD · SANDBOX</p>
      <h1>Política de privacidad</h1>
      <p className="legal-updated">Última actualización: 29 de agosto de 2026</p>
      <section><h2>1. Datos que tratamos</h2><p>Al crear una cuenta guardamos nombre, email, usuario, hash y salt de contraseña, sesiones y tokens de acción hasheados, secreto MFA cifrado, recovery codes hasheados e identidad OAuth cuando la configurás. En el sandbox también almacenamos organización, miembros, roles e invitaciones con vencimiento, customers, últimos cuatro dígitos del identificador fiscal, cuentas y tarjetas de prueba, transacciones, journals, holds, reglas y decisiones de riesgo, casos, partidas y excepciones de conciliación, checksum y nombre de importaciones, ciclos de settlement, auditoría y metadata de documentos. Los CSV de conciliación se descartan tras normalizarlos; los archivos de compliance se guardan en almacenamiento privado.</p></section>
      <section><h2>2. Finalidades</h2><p>Usamos estos datos para autenticarte, administrar el acceso por organización y rol, operar y asegurar el sandbox, mantener trazabilidad, responder solicitudes comerciales, prevenir abuso y diagnosticar fallas. No usamos datos del sandbox para mover fondos ni tomar decisiones crediticias reales.</p></section>
      <section><h2>3. Proveedores</h2><p>La plataforma usa Vercel para ejecución y almacenamiento privado, PostgreSQL administrado para persistencia y, al habilitarse, Resend para entregar emails transaccionales. Estos proveedores procesan datos sólo para prestar la infraestructura contratada y bajo sus controles de seguridad aplicables.</p></section>
      <section><h2>4. Seguridad</h2><p>Las contraseñas no se almacenan en texto plano. Usamos PBKDF2-HMAC-SHA-256, sesiones opacas revocables, cookies HttpOnly, MFA TOTP opcional, secretos cifrados, control de origen, aislamiento por organización, RBAC con jerarquía de privilegios, almacenamiento privado y auditoría. Ningún sistema elimina por completo el riesgo, por lo que no debés cargar información financiera real innecesaria.</p></section>
      <section><h2>5. Conservación</h2><p>Conservamos los datos mientras la cuenta sandbox esté activa y durante el tiempo necesario para seguridad, auditoría y obligaciones aplicables. La eliminación no es todavía autoservicio; podés solicitarla mediante el canal de contacto.</p></section>
      <section><h2>6. Derechos y contacto</h2><p>Podés solicitar acceso, corrección o eliminación de tus datos, sujeto a obligaciones legales y de seguridad. Enviá la solicitud desde el <Link href="/#demo">formulario de contacto</Link> usando el email asociado a tu cuenta.</p></section>
      <section><h2>7. Actualizaciones</h2><p>Publicaremos en esta página los cambios y su fecha de vigencia. Los cambios materiales se comunicarán por un canal apropiado antes de aplicarse cuando corresponda.</p></section>
    </article>
  </main>;
}
