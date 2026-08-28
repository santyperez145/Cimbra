import { ensureDatabase, getD1 } from '@/db/runtime';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import type { AuthUser, OAuthProvider } from './types';

type StoredUser = {
  userId: string; username: string; displayName: string; email: string; emailVerified: number;
  passwordHash: string | null; passwordSalt: string | null; passwordIterations: number | null;
};

export type AuthAttempt = { action: 'login' | 'register'; identityHash: string; ipHash: string };

export function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
}

export function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 30) : '';
}

export function validateRegistration(input: Record<string, unknown>) {
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (displayName.length < 2) return { error: 'Ingresá tu nombre completo.' } as const;
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return { error: 'El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.' } as const;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Ingresá un email válido.' } as const;
  if (password.length < 12 || password.length > 128) return { error: 'La contraseña debe tener entre 12 y 128 caracteres.' } as const;
  return { displayName, username, email, password } as const;
}

function toAuthUser(row: StoredUser): AuthUser {
  return { userId: row.userId, username: row.username, displayName: row.displayName, email: row.email, emailVerified: row.emailVerified === 1 };
}

export async function registerPasswordUser(input: { displayName: string; username: string; email: string; password: string }) {
  await ensureDatabase();
  const password = await hashPassword(input.password);
  const now = new Date().toISOString();
  const user: AuthUser = { userId: crypto.randomUUID(), username: input.username, displayName: input.displayName, email: input.email, emailVerified: false };
  try {
    await getD1().prepare(
      `INSERT INTO users (id, username, email, display_name, password_hash, password_salt, password_iterations, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(user.userId, user.username, user.email, user.displayName, password.hash, password.salt, password.iterations, now, now).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) throw new Error('Ese email o nombre de usuario ya está registrado.');
    throw error;
  }
  return user;
}

export async function authenticatePassword(identifier: string, password: string): Promise<AuthUser | null> {
  await ensureDatabase();
  const normalized = identifier.trim().toLowerCase().slice(0, 254);
  const row = await getD1().prepare(
    `SELECT id AS userId, username, display_name AS displayName, email, email_verified AS emailVerified,
      password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations
     FROM users WHERE email = ? OR username = ? LIMIT 1`,
  ).bind(normalized, normalized).first<StoredUser>();
  if (!row?.passwordHash || !row.passwordSalt || !row.passwordIterations) {
    await hashPassword(password.slice(0, 128));
    return null;
  }
  const valid = await verifyPassword(password, row.passwordHash, row.passwordSalt, row.passwordIterations);
  return valid ? toAuthUser(row) : null;
}

function requestIp(request: Request) {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

export async function authRateLimit(action: AuthAttempt['action'], identifier: string, request: Request) {
  await ensureDatabase();
  const identityHash = await sha256(`${action}:identity:${identifier.trim().toLowerCase()}`);
  const ipHash = await sha256(`${action}:ip:${requestIp(request)}`);
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const counts = await getD1().prepare(
    `SELECT
      SUM(CASE WHEN identity_hash = ? AND success = 0 THEN 1 ELSE 0 END) AS identityFailures,
      SUM(CASE WHEN ip_hash = ? AND success = 0 THEN 1 ELSE 0 END) AS ipFailures
     FROM auth_attempts WHERE action = ? AND created_at >= ?`,
  ).bind(identityHash, ipHash, action, since).first<{ identityFailures: number | null; ipFailures: number | null }>();
  const identityLimit = action === 'login' ? 8 : 3;
  const ipLimit = action === 'login' ? 40 : 10;
  return {
    limited: Number(counts?.identityFailures ?? 0) >= identityLimit || Number(counts?.ipFailures ?? 0) >= ipLimit,
    attempt: { action, identityHash, ipHash } satisfies AuthAttempt,
  };
}

export async function recordAuthAttempt(attempt: AuthAttempt, success: boolean) {
  await getD1().batch([
    getD1().prepare(
      'INSERT INTO auth_attempts (id, action, identity_hash, ip_hash, success, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), attempt.action, attempt.identityHash, attempt.ipHash, success ? 1 : 0, new Date().toISOString()),
    getD1().prepare('DELETE FROM auth_attempts WHERE created_at < ?').bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
}

function oauthUsername(email: string, displayName: string) {
  const source = (email.split('@')[0] || displayName || 'usuario').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const base = source.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 20) || 'usuario';
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
}

export async function findOrCreateOAuthUser(input: {
  provider: OAuthProvider; subject: string; email?: string; emailVerified: boolean; displayName?: string;
}): Promise<AuthUser> {
  await ensureDatabase();
  const db = getD1();
  const identity = await db.prepare(
    `SELECT u.id AS userId, u.username, u.display_name AS displayName, u.email, u.email_verified AS emailVerified,
      u.password_hash AS passwordHash, u.password_salt AS passwordSalt, u.password_iterations AS passwordIterations
     FROM oauth_identities i JOIN users u ON u.id = i.user_id
     WHERE i.provider = ? AND i.provider_subject = ? LIMIT 1`,
  ).bind(input.provider, input.subject).first<StoredUser>();
  if (identity) return toAuthUser(identity);

  const email = normalizeEmail(input.email);
  if (!email || !input.emailVerified) throw new Error('El proveedor no devolvió un email verificado para crear la cuenta.');
  const existing = await db.prepare(
    `SELECT id AS userId, username, display_name AS displayName, email, email_verified AS emailVerified,
      password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations
     FROM users WHERE email = ? LIMIT 1`,
  ).bind(email).first<StoredUser>();
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare(
      'INSERT INTO oauth_identities (id, user_id, provider, provider_subject, provider_email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), existing.userId, input.provider, input.subject, email, now).run();
    if (!existing.emailVerified) await db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, existing.userId).run();
    return { ...toAuthUser(existing), emailVerified: true };
  }

  const user: AuthUser = {
    userId: crypto.randomUUID(),
    username: oauthUsername(email, input.displayName ?? ''),
    displayName: input.displayName?.trim().slice(0, 100) || email.split('@')[0],
    email,
    emailVerified: true,
  };
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, username, email, display_name, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(user.userId, user.username, user.email, user.displayName, now, now),
    db.prepare(
      'INSERT INTO oauth_identities (id, user_id, provider, provider_subject, provider_email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), user.userId, input.provider, input.subject, user.email, now),
  ]);
  return user;
}
