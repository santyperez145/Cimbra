import { ensureDatabase, getDatabase } from '@/db/runtime';
import { hashPassword, randomToken, sha256 } from './crypto';
import { sendAuthMail } from './mailer';

type ActionTokenType = 'email_verification' | 'password_reset' | 'mfa_challenge';

function tokenLifetime(type: ActionTokenType) {
  if (type === 'email_verification') return 24 * 60 * 60 * 1000;
  if (type === 'password_reset') return 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

async function actionTokenHash(type: ActionTokenType, token: string) {
  return sha256(`cimbra-auth-token:${type}:${token}`);
}

export async function issueActionToken(userId: string, type: ActionTokenType) {
  await ensureDatabase();
  const token = randomToken(32);
  const id = crypto.randomUUID();
  const now = new Date();
  const db = getDatabase();
  await db.transaction(async (transaction) => {
    await transaction.prepare(
      'UPDATE auth_action_tokens SET consumed_at = ? WHERE user_id = ? AND type = ? AND consumed_at IS NULL',
    ).bind(now.toISOString(), userId, type).run();
    await transaction.prepare(
      `INSERT INTO auth_action_tokens (id, user_id, type, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, type, await actionTokenHash(type, token), new Date(now.getTime() + tokenLifetime(type)).toISOString(), now.toISOString()).run();
    await transaction.prepare('DELETE FROM auth_action_tokens WHERE expires_at < ?').bind(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()).run();
  });
  return { id, token };
}

async function revokeActionToken(id: string) {
  await getDatabase().prepare('UPDATE auth_action_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .bind(new Date().toISOString(), id).run();
}

export async function sendEmailVerification(input: { userId: string; email: string; displayName: string; origin: string }) {
  const issued = await issueActionToken(input.userId, 'email_verification');
  const url = new URL('/verify-email', input.origin);
  url.searchParams.set('token', issued.token);
  try {
    const sent = await sendAuthMail({
      to: input.email,
      subject: 'Verificá tu email en Cimbra',
      heading: `Hola, ${input.displayName.split(' ')[0] || input.displayName}`,
      message: 'Confirmá que este email te pertenece para proteger tu cuenta y habilitar operaciones sensibles.',
      actionLabel: 'Verificar email',
      actionUrl: url.toString(),
      idempotencyKey: `verify-${issued.id}`,
    });
    if (!sent) await revokeActionToken(issued.id);
    return sent;
  } catch (error) {
    await revokeActionToken(issued.id);
    console.error('Verification email delivery failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function requestPasswordReset(input: { email: string; origin: string }) {
  await ensureDatabase();
  const user = await getDatabase().prepare(
    'SELECT id, email, display_name AS "displayName" FROM users WHERE email = ? AND email_verified = 1 LIMIT 1',
  ).bind(input.email).first<{ id: string; email: string; displayName: string }>();
  if (!user) return false;
  const issued = await issueActionToken(user.id, 'password_reset');
  const url = new URL('/reset-password', input.origin);
  url.searchParams.set('token', issued.token);
  try {
    const sent = await sendAuthMail({
      to: user.email,
      subject: 'Restablecé tu contraseña de Cimbra',
      heading: 'Restablecer contraseña',
      message: 'Recibimos una solicitud para cambiar tu contraseña. El enlace vence en 60 minutos y sólo puede usarse una vez.',
      actionLabel: 'Crear nueva contraseña',
      actionUrl: url.toString(),
      idempotencyKey: `password-reset-${issued.id}`,
    });
    if (!sent) await revokeActionToken(issued.id);
    return sent;
  } catch (error) {
    await revokeActionToken(issued.id);
    console.error('Password reset email delivery failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function verifyEmailToken(token: string) {
  if (token.length < 32 || token.length > 100) return false;
  await ensureDatabase();
  const now = new Date().toISOString();
  return getDatabase().transaction(async (transaction) => {
    const consumed = await transaction.prepare(
      `UPDATE auth_action_tokens SET consumed_at = ?
       WHERE token_hash = ? AND type = 'email_verification' AND consumed_at IS NULL AND expires_at > ?
       RETURNING user_id AS "userId"`,
    ).bind(now, await actionTokenHash('email_verification', token), now).first<{ userId: string }>();
    if (!consumed) return false;
    await transaction.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, consumed.userId).run();
    return true;
  });
}

export async function resetPasswordWithToken(token: string, password: string) {
  if (token.length < 32 || token.length > 100) return false;
  const derived = await hashPassword(password);
  await ensureDatabase();
  const now = new Date().toISOString();
  const result = await getDatabase().transaction(async (transaction) => {
    const consumed = await transaction.prepare(
      `UPDATE auth_action_tokens SET consumed_at = ?
       WHERE token_hash = ? AND type = 'password_reset' AND consumed_at IS NULL AND expires_at > ?
       RETURNING user_id AS "userId"`,
    ).bind(now, await actionTokenHash('password_reset', token), now).first<{ userId: string }>();
    if (!consumed) return null;
    await transaction.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?`,
    ).bind(derived.hash, derived.salt, derived.iterations, now, consumed.userId).run();
    await transaction.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(consumed.userId).run();
    await transaction.prepare(
      `UPDATE auth_action_tokens SET consumed_at = ? WHERE user_id = ? AND type = 'password_reset' AND consumed_at IS NULL`,
    ).bind(now, consumed.userId).run();
    return transaction.prepare('SELECT email, display_name AS "displayName" FROM users WHERE id = ? LIMIT 1')
      .bind(consumed.userId).first<{ email: string; displayName: string }>();
  });
  if (!result) return false;
  await sendAuthMail({
    to: result.email,
    subject: 'Tu contraseña de Cimbra fue actualizada',
    heading: 'Contraseña actualizada',
    message: 'La contraseña de tu cuenta se cambió y cerramos todas las sesiones existentes. Si no fuiste vos, contactá inmediatamente al equipo de seguridad.',
    idempotencyKey: `password-changed-${await sha256(`${result.email}:${now}`)}`,
  }).catch((error) => console.error('Password change notification failed', error instanceof Error ? error.message : String(error)));
  return true;
}
