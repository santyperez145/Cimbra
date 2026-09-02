import type { AuthUser } from '@/app/lib/auth/types';
import { getCurrentUser } from '@/app/lib/auth/session';
import { mutationAllowed } from '@/app/lib/auth/http';
import { ApiAuthorizationError } from './authorization.ts';
import {
  isPlatformOperatorEmail, platformOperatorProvisioned, type PlatformOperatorRole,
} from './platform-operators.ts';

export {
  PLATFORM_OPERATOR_ROLES, canMutateAsPlatformOperator, isPlatformOperatorEmail,
  platformOperatorEmails, platformOperatorProvisioned, type PlatformOperatorRole,
} from './platform-operators.ts';

export async function authorizePlatformOperator(request: Request, options: { mutation?: boolean } = {}) {
  if (options.mutation && !mutationAllowed(request)) {
    throw new ApiAuthorizationError('Origen de solicitud no permitido.', 403, 'origin_not_allowed');
  }
  const user = await getCurrentUser(request);
  if (!user) throw new ApiAuthorizationError('Autenticación requerida.', 401, 'authentication_required');
  if (!isPlatformOperatorEmail(user.email)) {
    throw new ApiAuthorizationError('Esta superficie es sólo para operadores de plataforma Cimbra provisionados por CIMBRA_PLATFORM_OPERATOR_EMAILS.', 403, 'platform_operator_required');
  }
  if (options.mutation && !user.emailVerified) {
    throw new ApiAuthorizationError('Verificá el email antes de operar la superadministración.', 403, 'email_verification_required');
  }
  return { user, role: 'owner' as PlatformOperatorRole };
}

export function describePlatformOperator(user: AuthUser) {
  return {
    provisioned: platformOperatorProvisioned(),
    authorized: isPlatformOperatorEmail(user.email),
    email: user.email,
  };
}
