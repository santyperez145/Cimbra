import { NextResponse } from 'next/server';
import { authRateLimit, recordAuthAttempt } from '@/app/lib/auth/accounts';
import { publicOrigin } from '@/app/lib/auth/config';
import { mutationAllowed } from '@/app/lib/auth/http';
import { sendEmailVerification } from '@/app/lib/auth/lifecycle';
import { getCurrentUser } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });
  const rate = await authRateLimit('email_verification', user.email, request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  const sent = await sendEmailVerification({ userId: user.userId, email: user.email, displayName: user.displayName, origin: publicOrigin(request) });
  await recordAuthAttempt(rate.attempt, false);
  if (!sent) return NextResponse.json({ error: 'El servicio de email todavía no está configurado para este entorno.' }, { status: 503 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
