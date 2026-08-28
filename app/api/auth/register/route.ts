import { NextResponse } from 'next/server';
import { authRateLimit, recordAuthAttempt, registerPasswordUser, validateRegistration } from '@/app/lib/auth/accounts';
import { mutationAllowed } from '@/app/lib/auth/http';
import { createSession } from '@/app/lib/auth/session';
import { publicOrigin } from '@/app/lib/auth/config';
import { sendEmailVerification } from '@/app/lib/auth/lifecycle';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  const validated = validateRegistration(body);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const rate = await authRateLimit('register', validated.email, request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  try {
    const user = await registerPasswordUser(validated);
    await recordAuthAttempt(rate.attempt, true);
    const verificationEmailSent = await sendEmailVerification({
      userId: user.userId, email: user.email, displayName: user.displayName, origin: publicOrigin(request),
    });
    const response = NextResponse.json({
      ok: true,
      user: { username: user.username, displayName: user.displayName, email: user.email, emailVerified: false },
      verificationEmailSent,
    }, { status: 201 });
    await createSession(user.userId, request, response);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    await recordAuthAttempt(rate.attempt, false);
    const message = error instanceof Error ? error.message : 'No pudimos crear la cuenta.';
    return NextResponse.json({ error: message }, { status: /registrado/.test(message) ? 409 : 500 });
  }
}
