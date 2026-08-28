import type { ApiPrincipal } from './authorization';

export class IdempotencyError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'invalid_idempotency_key') { super(message); }
}

export function requestIdempotencyKey(request: Request, principal: ApiPrincipal) {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  const required = principal.authentication === 'api_key' || new URL(request.url).pathname.startsWith('/api/v1/');
  if (!value) {
    if (required) throw new IdempotencyError('Idempotency-Key es requerido para todas las escrituras de la API v1.');
    return null;
  }
  if (value.length < 8 || value.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new IdempotencyError('Idempotency-Key debe tener entre 8 y 100 caracteres seguros.');
  }
  return value;
}
