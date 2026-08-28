import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { ensureDatabase, getDatabase } from '@/db/runtime';
import { randomToken, sha256 } from './crypto';
import { safeReturnTo } from './config';
import type { AuthUser } from './types';

const SESSION_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_NAMES = ['__Host-cimbra_session', 'cimbra_session'] as const;

function cookieName(request: Request) {
  return new URL(request.url).protocol === 'https:' ? COOKIE_NAMES[0] : COOKIE_NAMES[1];
}

function cookieFromRequest(request: Request, names: readonly string[]): string | undefined {
  const values = new Map(
    (request.headers.get('cookie') ?? '').split(';').map((item) => {
      const separator = item.indexOf('=');
      return separator < 0 ? ['', ''] : [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
    }),
  );
  for (const name of names) {
    const value = values.get(name);
    if (value) return value;
  }
  return undefined;
}

async function sessionToken(request?: Request) {
  if (request) return cookieFromRequest(request, COOKIE_NAMES);
  const cookieStore = await cookies();
  for (const name of COOKIE_NAMES) {
    const value = cookieStore.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

export async function getCurrentUser(request?: Request): Promise<AuthUser | null> {
  const token = await sessionToken(request);
  if (!token) return null;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const row = await getDatabase().prepare(
    `SELECT u.id AS userId, u.username, u.display_name AS displayName, u.email,
      u.email_verified AS emailVerified, u.mfa_enabled AS mfaEnabled
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
  ).bind(tokenHash, new Date().toISOString()).first<{
    userId: string; username: string; displayName: string; email: string; emailVerified: number; mfaEnabled: number;
  }>();
  return row ? { ...row, emailVerified: row.emailVerified === 1, mfaEnabled: row.mfaEnabled === 1 } : null;
}

export async function requireUser(returnTo = '/console'): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;
  redirect(`/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
}

export async function createSession(userId: string, request: Request, response: NextResponse) {
  await ensureDatabase();
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const db = getDatabase();
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare(
      'INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(await sha256(token), userId, expires.toISOString(), now.toISOString(), now.toISOString()),
  ]);
  response.cookies.set(cookieName(request), token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

export async function destroySession(request: Request, response: NextResponse) {
  const token = await sessionToken(request);
  if (token) {
    await ensureDatabase();
    await getDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  for (const name of COOKIE_NAMES) response.cookies.set(name, '', { httpOnly: true, secure: name.startsWith('__Host-'), sameSite: 'lax', path: '/', maxAge: 0 });
}

export function readRequestCookie(request: Request, names: readonly string[]) {
  return cookieFromRequest(request, names);
}
