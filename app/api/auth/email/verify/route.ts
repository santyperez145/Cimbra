import { NextResponse } from 'next/server';
import { authRateLimit, recordAuthAttempt } from '@/app/lib/auth/accounts';
import { mutationAllowed } from '@/app/lib/auth/http';
import { verifyEmailToken } from '@/app/lib/auth/lifecycle';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const rate = await authRateLimit('email_verification', token || 'invalid', request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  const verified = await verifyEmailToken(token);
  await recordAuthAttempt(rate.attempt, verified);
  if (!verified) return NextResponse.json({ error: 'El enlace de verificación no es válido o ya venció.' }, { status: 400 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
