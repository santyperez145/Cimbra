import { trustedMutationOrigins } from './config.ts';

export function mutationAllowed(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return trustedMutationOrigins(request).has(new URL(origin).origin);
  } catch {
    return false;
  }
}
