import { NextResponse } from 'next/server';
import { authenticatePassword, authRateLimit, recordAuthAttempt } from '@/app/lib/auth/accounts';
import { mutationAllowed } from '@/app/lib/auth/http';
import { createSession } from '@/app/lib/auth/session';
import { issueMfaChallenge } from '@/app/lib/auth/mfa';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim().slice(0, 254) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!identifier || !password || password.length > 128) return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  const rate = await authRateLimit('login', identifier, request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  const user = await authenticatePassword(identifier, password);
  await recordAuthAttempt(rate.attempt, Boolean(user));
  if (!user) return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  if (user.mfaEnabled) {
    const challengeToken = await issueMfaChallenge(user.userId);
    return NextResponse.json({ ok: true, mfaRequired: true, challengeToken }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const response = NextResponse.json({ ok: true, user: { username: user.username, displayName: user.displayName, email: user.email } });
  await createSession(user.userId, request, response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
