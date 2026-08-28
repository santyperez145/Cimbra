import { NextResponse } from 'next/server';
import { authRateLimit, recordAuthAttempt, validateNewPassword } from '@/app/lib/auth/accounts';
import { mutationAllowed } from '@/app/lib/auth/http';
import { resetPasswordWithToken } from '@/app/lib/auth/lifecycle';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const password = validateNewPassword(body?.password);
  if (!password) return NextResponse.json({ error: 'La contraseña debe tener entre 12 y 128 caracteres.' }, { status: 400 });
  const rate = await authRateLimit('password_reset', token || 'invalid', request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  const changed = await resetPasswordWithToken(token, password);
  await recordAuthAttempt(rate.attempt, changed);
  if (!changed) return NextResponse.json({ error: 'El enlace de recuperación no es válido o ya venció.' }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
