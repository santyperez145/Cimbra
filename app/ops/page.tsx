import Link from 'next/link';
import { requireUser } from '@/app/lib/auth/session';
import { isPlatformOperatorEmail, platformOperatorProvisioned } from '@/app/lib/platform/platform-ops';
import OpsClient from './ops-client';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const user = await requireUser('/ops');
  if (!isPlatformOperatorEmail(user.email)) {
    return <main className="ops-denied">
      <h1>Superadministración de Cimbra</h1>
      <p>
        {platformOperatorProvisioned()
          ? 'Tu cuenta no está provisionada como operador de plataforma. Esta superficie gobierna todos los tenants, por eso el acceso se otorga por lista explícita y no por rol del tenant.'
          : 'Todavía no hay operadores de plataforma provisionados. Definí CIMBRA_PLATFORM_OPERATOR_EMAILS en el entorno para habilitar esta superficie.'}
      </p>
      <Link href="/console">Volver a la consola</Link>
    </main>;
  }
  return <OpsClient operatorEmail={user.email} />;
}
