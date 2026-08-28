import { NextResponse } from 'next/server';
import { authRateLimit, normalizeEmail, recordAuthAttempt } from '@/app/lib/auth/accounts';
import { publicOrigin } from '@/app/lib/auth/config';
import { mutationAllowed } from '@/app/lib/auth/http';
import { requestPasswordReset } from '@/app/lib/auth/lifecycle';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  const rate = await authRateLimit('password_reset', email || 'invalid', request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await requestPasswordReset({ email, origin: publicOrigin(request) });
  }
  await recordAuthAttempt(rate.attempt, false);
  return NextResponse.json({ ok: true, message: 'Si existe una cuenta verificada con ese email, enviaremos un enlace de recuperación.' }, { headers: { 'Cache-Control': 'no-store' } });
}
