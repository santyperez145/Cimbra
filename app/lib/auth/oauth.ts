import { NextResponse } from 'next/server';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { ensureDatabase, getDatabase } from '@/db/runtime';
import { appleConfig, googleConfig, providerIsAvailable, publicOrigin, safeReturnTo } from './config';
import { findOrCreateOAuthUser } from './accounts';
import { randomToken, sha256 } from './crypto';
import { createSession, readRequestCookie } from './session';
import type { OAuthProvider } from './types';
import { issueMfaChallenge, setMfaChallengeCookie } from './mfa';

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_KEYS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const OAUTH_COOKIE_NAMES = ['__Host-cimbra_oauth', 'cimbra_oauth'] as const;

function oauthCookieName(request: Request) {
  return new URL(request.url).protocol === 'https:' ? OAUTH_COOKIE_NAMES[0] : OAUTH_COOKIE_NAMES[1];
}

function errorRedirect(request: Request, message: string) {
  const target = new URL('/login', publicOrigin(request));
  target.searchParams.set('error', message);
  return NextResponse.redirect(target);
}

function clearOAuthCookie(response: NextResponse) {
  for (const name of OAUTH_COOKIE_NAMES) response.cookies.set(name, '', { httpOnly: true, secure: name.startsWith('__Host-'), sameSite: name.startsWith('__Host-') ? 'none' : 'lax', path: '/', maxAge: 0 });
}

export async function startOAuth(provider: OAuthProvider, request: Request) {
  if (!providerIsAvailable(provider)) return errorRedirect(request, `El acceso con ${provider === 'google' ? 'Google' : 'Apple'} todavía no está configurado.`);
  await ensureDatabase();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const nonce = randomToken(24);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return_to'));
  const origin = publicOrigin(request);
  const callback = `${origin}/api/auth/oauth/${provider}/callback`;
  const now = new Date();
  const db = getDatabase();
  await db.batch([
    db.prepare(
      `INSERT INTO oauth_states (state_hash, provider, code_verifier, nonce, return_to, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256(state), provider, verifier, nonce, returnTo, new Date(now.getTime() + 10 * 60 * 1000).toISOString(), now.toISOString()),
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now.toISOString()),
  ]);

  let authorization: URL;
  if (provider === 'google') {
    const { clientId } = googleConfig();
    authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await sha256(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
  } else {
    const { clientId } = appleConfig();
    authorization = new URL('https://appleid.apple.com/auth/authorize');
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
      nonce,
    }).toString();
  }
  const response = NextResponse.redirect(authorization);
  response.cookies.set(oauthCookieName(request), state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: new URL(request.url).protocol === 'https:' ? 'none' : 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}

async function appleClientSecret() {
  const config = appleConfig();
  const key = await importPKCS8(config.privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}

type CallbackValues = { code?: string; state?: string; error?: string; user?: string };

export async function finishOAuth(provider: OAuthProvider, request: Request, values: CallbackValues) {
  try {
    if (values.error) return errorRedirect(request, 'El proveedor canceló o rechazó el acceso.');
    const code = values.code?.trim();
    const state = values.state?.trim();
    const cookieState = readRequestCookie(request, OAUTH_COOKIE_NAMES);
    if (!code || !state || !cookieState || state !== cookieState) return errorRedirect(request, 'La solicitud de acceso venció o no es válida.');
    await ensureDatabase();
    const stateHash = await sha256(state);
    const saved = await getDatabase().prepare(
      `SELECT code_verifier AS codeVerifier, nonce, return_to AS returnTo, expires_at AS expiresAt
       FROM oauth_states WHERE state_hash = ? AND provider = ? LIMIT 1`,
    ).bind(stateHash, provider).first<{ codeVerifier: string; nonce: string; returnTo: string; expiresAt: string }>();
    await getDatabase().prepare('DELETE FROM oauth_states WHERE state_hash = ?').bind(stateHash).run();
    if (!saved || saved.expiresAt <= new Date().toISOString()) return errorRedirect(request, 'La solicitud de acceso venció o no es válida.');

    const origin = publicOrigin(request);
    const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
    let idToken: string;
    let user;
    if (provider === 'google') {
      const config = googleConfig();
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.codeVerifier }),
      });
      const tokens = await tokenResponse.json() as { id_token?: string };
      if (!tokenResponse.ok || !tokens.id_token) throw new Error('Google no pudo validar el código de acceso.');
      idToken = tokens.id_token;
      const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: config.clientId,
      });
      if (payload.nonce !== saved.nonce || typeof payload.sub !== 'string') throw new Error('El token de Google no es válido.');
      user = await findOrCreateOAuthUser({
        provider,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true,
        displayName: typeof payload.name === 'string' ? payload.name : undefined,
      });
    } else {
      const config = appleConfig();
      const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, client_secret: await appleClientSecret(), code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
      });
      const tokens = await tokenResponse.json() as { id_token?: string };
      if (!tokenResponse.ok || !tokens.id_token) throw new Error('Apple no pudo validar el código de acceso.');
      idToken = tokens.id_token;
      const { payload } = await jwtVerify(idToken, APPLE_KEYS, { issuer: 'https://appleid.apple.com', audience: config.clientId });
      if (payload.nonce !== saved.nonce || typeof payload.sub !== 'string') throw new Error('El token de Apple no es válido.');
      let displayName: string | undefined;
      if (values.user) {
        try {
          const profile = JSON.parse(values.user) as { name?: { firstName?: string; lastName?: string } };
          displayName = [profile.name?.firstName, profile.name?.lastName].filter(Boolean).join(' ') || undefined;
        } catch { /* Apple sends this optional JSON only on first authorization. */ }
      }
      user = await findOrCreateOAuthUser({
        provider,
        subject: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        displayName,
      });
    }

    const response = user.mfaEnabled
      ? NextResponse.redirect(new URL(`/login?mfa=1&return_to=${encodeURIComponent(safeReturnTo(saved.returnTo))}`, origin))
      : NextResponse.redirect(new URL(safeReturnTo(saved.returnTo), origin));
    if (user.mfaEnabled) setMfaChallengeCookie(request, response, await issueMfaChallenge(user.userId));
    else await createSession(user.userId, request, response);
    clearOAuthCookie(response);
    return response;
  } catch (error) {
    console.error('OAuth callback failed', error instanceof Error ? error.message : String(error));
    const response = errorRedirect(request, 'No pudimos completar el acceso. Intentá nuevamente.');
    clearOAuthCookie(response);
    return response;
  }
}
