import type { OAuthProvider } from './types';

function setting(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function publicOrigin(request: Request): string {
  const configured = setting('CIMBRA_PUBLIC_URL');
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function requestHostOrigin(request: Request): string | null {
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || request.headers.get('host')?.trim();
  if (!host) return null;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || new URL(request.url).protocol.replace(':', '');
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/** Orígenes confiables para mutaciones same-site: host de la request, Host header y CIMBRA_PUBLIC_URL. */
export function trustedMutationOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch { /* ignore malformed request URL */ }
  const fromHost = requestHostOrigin(request);
  if (fromHost) origins.add(fromHost);
  const configured = setting('CIMBRA_PUBLIC_URL');
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch { /* ignore malformed env */ }
  }
  return origins;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/console';
  try {
    const url = new URL(value, 'https://cimbra.local');
    return url.origin === 'https://cimbra.local' ? `${url.pathname}${url.search}${url.hash}` : '/console';
  } catch {
    return '/console';
  }
}

export function oauthAvailability() {
  return {
    google: Boolean(setting('GOOGLE_CLIENT_ID') && setting('GOOGLE_CLIENT_SECRET')),
    apple: Boolean(setting('APPLE_CLIENT_ID') && setting('APPLE_TEAM_ID') && setting('APPLE_KEY_ID') && setting('APPLE_PRIVATE_KEY')),
  };
}

export function googleConfig() {
  const clientId = setting('GOOGLE_CLIENT_ID');
  const clientSecret = setting('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Google OAuth no está configurado.');
  return { clientId, clientSecret };
}

export function appleConfig() {
  const clientId = setting('APPLE_CLIENT_ID');
  const teamId = setting('APPLE_TEAM_ID');
  const keyId = setting('APPLE_KEY_ID');
  const privateKey = setting('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!clientId || !teamId || !keyId || !privateKey) throw new Error('Apple OAuth no está configurado.');
  return { clientId, teamId, keyId, privateKey };
}

export function providerIsAvailable(provider: OAuthProvider): boolean {
  return oauthAvailability()[provider];
}
