import { redirect } from 'next/navigation';
import Link from 'next/link';
import { oauthAvailability, safeReturnTo } from '@/app/lib/auth/config';
import { getCurrentUser } from '@/app/lib/auth/session';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(typeof params.return_to === 'string' ? params.return_to : undefined);
  if (await getCurrentUser()) redirect(returnTo);
  const error = typeof params.error === 'string' ? params.error : '';
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
        <LoginForm availability={oauthAvailability()} returnTo={returnTo} initialError={error} />
        <p className="auth-legal">Al continuar aceptás los <Link href="/#demo">Términos</Link> y la <Link href="/#demo">Política de privacidad</Link> de Cimbra.</p>
      </section>
    </main>
  );
}
