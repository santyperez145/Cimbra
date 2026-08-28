import { type DatabaseClient } from '@/db/client';
import { ensureDatabase, getDatabase } from '@/db/runtime';
import { decryptSecret, encryptSecret } from '@/app/lib/security/secrets';
import { issueActionToken } from './lifecycle';
import { sha256, verifyPassword } from './crypto';
import { readRequestCookie } from './session';
import type { NextResponse } from 'next/server';
import {
  createRecoveryCode, createTotpSecret, normalizeRecoveryCode, recoveryCodeHash,
  totpProvisioningUri, verifyTotp,
} from './totp';

export class MfaError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const MFA_CHALLENGE_COOKIE_NAMES = ['__Host-cimbra_mfa_challenge', 'cimbra_mfa_challenge'] as const;

export function setMfaChallengeCookie(request: Request, response: NextResponse, token: string) {
  const secure = new URL(request.url).protocol === 'https:';
  response.cookies.set(secure ? MFA_CHALLENGE_COOKIE_NAMES[0] : MFA_CHALLENGE_COOKIE_NAMES[1], token, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 5 * 60,
  });
}

export function readMfaChallengeCookie(request: Request) {
  return readRequestCookie(request, MFA_CHALLENGE_COOKIE_NAMES);
}

export function clearMfaChallengeCookie(response: NextResponse) {
  for (const name of MFA_CHALLENGE_COOKIE_NAMES) {
    response.cookies.set(name, '', { httpOnly: true, secure: name.startsWith('__Host-'), sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

async function verifyCurrentPassword(userId: string, password: string) {
  const row = await getDatabase().prepare(
    `SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt", password_iterations AS "passwordIterations"
     FROM users WHERE id = ? LIMIT 1`,
  ).bind(userId).first<{ passwordHash: string | null; passwordSalt: string | null; passwordIterations: number | null }>();
  if (!row) return false;
  if (!row.passwordHash || !row.passwordSalt || !row.passwordIterations) return true;
  if (!password || password.length > 128) return false;
  return verifyPassword(password, row.passwordHash, row.passwordSalt, row.passwordIterations);
}

export async function beginMfaSetup(input: { userId: string; email: string; currentPassword: string }) {
  await ensureDatabase();
  const user = await getDatabase().prepare('SELECT mfa_enabled AS "mfaEnabled" FROM users WHERE id = ? LIMIT 1')
    .bind(input.userId).first<{ mfaEnabled: number }>();
  if (!user) throw new MfaError('Cuenta no encontrada.', 404);
  if (user.mfaEnabled === 1) throw new MfaError('MFA ya está activo. Desactivalo antes de vincular otro autenticador.', 409);
  if (!(await verifyCurrentPassword(input.userId, input.currentPassword))) throw new MfaError('La contraseña actual no es correcta.', 401);
  const secret = createTotpSecret();
  await getDatabase().prepare(
    'UPDATE users SET mfa_secret_ciphertext = ?, mfa_last_used_step = NULL, updated_at = ? WHERE id = ?',
  ).bind(await encryptSecret(secret), new Date().toISOString(), input.userId).run();
  return { secret, provisioningUri: totpProvisioningUri(secret, input.email) };
}

export async function enableMfa(userId: string, code: string) {
  await ensureDatabase();
  const user = await getDatabase().prepare(
    'SELECT mfa_enabled AS "mfaEnabled", mfa_secret_ciphertext AS "secretCiphertext" FROM users WHERE id = ? LIMIT 1',
  ).bind(userId).first<{ mfaEnabled: number; secretCiphertext: string | null }>();
  if (!user?.secretCiphertext) throw new MfaError('Primero iniciá la configuración del autenticador.', 409);
  if (user.mfaEnabled === 1) throw new MfaError('MFA ya está activo.', 409);
  const step = await verifyTotp(await decryptSecret(user.secretCiphertext), code);
  if (step === null) throw new MfaError('El código del autenticador no es válido.', 401);
  const recoveryCodes = Array.from({ length: 8 }, () => createRecoveryCode());
  const recoveryHashes = await Promise.all(recoveryCodes.map((item) => recoveryCodeHash(item)));
  const now = new Date().toISOString();
  await getDatabase().transaction(async (transaction) => {
    const enabled = await transaction.prepare(
      `UPDATE users SET mfa_enabled = 1, mfa_last_used_step = ?, updated_at = ?
       WHERE id = ? AND mfa_enabled = 0 AND mfa_secret_ciphertext IS NOT NULL RETURNING id`,
    ).bind(step.toString(), now, userId).first<{ id: string }>();
    if (!enabled) throw new MfaError('No pudimos activar MFA porque el estado de la cuenta cambió.', 409);
    await transaction.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').bind(userId).run();
    for (const hash of recoveryHashes) {
      await transaction.prepare(
        'INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, hash, now).run();
    }
  });
  return recoveryCodes;
}

async function verifyFactor(database: DatabaseClient, userId: string, code: string) {
  const user = await database.prepare(
    `SELECT mfa_enabled AS "mfaEnabled", mfa_secret_ciphertext AS "secretCiphertext",
      mfa_last_used_step::text AS "lastUsedStep" FROM users WHERE id = ? LIMIT 1`,
  ).bind(userId).first<{ mfaEnabled: number; secretCiphertext: string | null; lastUsedStep: string | null }>();
  if (!user || user.mfaEnabled !== 1 || !user.secretCiphertext) return false;
  if (/^\s*\d{6}\s*$/.test(code)) {
    const step = await verifyTotp(await decryptSecret(user.secretCiphertext), code);
    if (step === null || (user.lastUsedStep !== null && step <= BigInt(user.lastUsedStep))) return false;
    const updated = await database.prepare(
      `UPDATE users SET mfa_last_used_step = ?, updated_at = ?
       WHERE id = ? AND mfa_enabled = 1 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < ?) RETURNING id`,
    ).bind(step.toString(), new Date().toISOString(), userId, step.toString()).first<{ id: string }>();
    return Boolean(updated);
  }
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 20) return false;
  const recovered = await database.prepare(
    `UPDATE mfa_recovery_codes SET consumed_at = ?
     WHERE user_id = ? AND code_hash = ? AND consumed_at IS NULL RETURNING id`,
  ).bind(new Date().toISOString(), userId, await recoveryCodeHash(normalized)).first<{ id: string }>();
  return Boolean(recovered);
}

export async function issueMfaChallenge(userId: string) {
  return (await issueActionToken(userId, 'mfa_challenge')).token;
}

export async function completeMfaChallenge(challengeToken: string, code: string) {
  if (challengeToken.length < 32 || challengeToken.length > 100) return null;
  await ensureDatabase();
  const tokenHash = await sha256(`cimbra-auth-token:mfa_challenge:${challengeToken}`);
  const now = new Date().toISOString();
  return getDatabase().transaction(async (transaction) => {
    const challenge = await transaction.prepare(
      `SELECT user_id AS "userId" FROM auth_action_tokens
       WHERE token_hash = ? AND type = 'mfa_challenge' AND consumed_at IS NULL AND expires_at > ? LIMIT 1 FOR UPDATE`,
    ).bind(tokenHash, now).first<{ userId: string }>();
    if (!challenge || !(await verifyFactor(transaction, challenge.userId, code))) return null;
    const consumed = await transaction.prepare(
      'UPDATE auth_action_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL RETURNING user_id AS "userId"',
    ).bind(now, tokenHash).first<{ userId: string }>();
    return consumed?.userId ?? null;
  });
}

export async function disableMfa(input: { userId: string; currentPassword: string; code: string }) {
  await ensureDatabase();
  if (!(await verifyCurrentPassword(input.userId, input.currentPassword))) throw new MfaError('La contraseña actual no es correcta.', 401);
  const now = new Date().toISOString();
  await getDatabase().transaction(async (transaction) => {
    if (!(await verifyFactor(transaction, input.userId, input.code))) throw new MfaError('El código de seguridad no es válido.', 401);
    await transaction.prepare(
      `UPDATE users SET mfa_enabled = 0, mfa_secret_ciphertext = NULL, mfa_last_used_step = NULL, updated_at = ? WHERE id = ?`,
    ).bind(now, input.userId).run();
    await transaction.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').bind(input.userId).run();
    await transaction.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(input.userId).run();
    await transaction.prepare(
      `UPDATE auth_action_tokens SET consumed_at = ? WHERE user_id = ? AND type = 'mfa_challenge' AND consumed_at IS NULL`,
    ).bind(now, input.userId).run();
  });
}

export async function remainingRecoveryCodes(userId: string) {
  await ensureDatabase();
  const row = await getDatabase().prepare(
    'SELECT COUNT(*)::int AS count FROM mfa_recovery_codes WHERE user_id = ? AND consumed_at IS NULL',
  ).bind(userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
