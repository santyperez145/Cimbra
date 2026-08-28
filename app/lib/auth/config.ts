import { env } from 'cloudflare:workers';
import type { OAuthProvider } from './types';

function setting(name: keyof Cloudflare.Env): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function publicOrigin(request: Request): string {
  const configured = setting('CIMBRA_PUBLIC_URL');
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
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
