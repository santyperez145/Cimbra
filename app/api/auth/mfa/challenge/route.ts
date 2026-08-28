import { NextResponse } from 'next/server';
import { authRateLimit, recordAuthAttempt } from '@/app/lib/auth/accounts';
import { mutationAllowed } from '@/app/lib/auth/http';
import { clearMfaChallengeCookie, completeMfaChallenge, readMfaChallengeCookie } from '@/app/lib/auth/mfa';
import { createSession } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { challengeToken?: unknown; code?: unknown } | null;
  const challengeToken = typeof body?.challengeToken === 'string' ? body.challengeToken.trim() : readMfaChallengeCookie(request) ?? '';
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 40) : '';
  const rate = await authRateLimit('mfa', challengeToken || 'invalid', request);
  if (rate.limited) return NextResponse.json({ error: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.' }, { status: 429 });
  const userId = challengeToken && code ? await completeMfaChallenge(challengeToken, code) : null;
  await recordAuthAttempt(rate.attempt, Boolean(userId));
  if (!userId) return NextResponse.json({ error: 'El código no es válido o el desafío venció.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  await createSession(userId, request, response);
  clearMfaChallengeCookie(response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
