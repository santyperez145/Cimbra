import { NextResponse } from 'next/server';
import { mutationAllowed } from '@/app/lib/auth/http';
import { enableMfa, MfaError } from '@/app/lib/auth/mfa';
import { getCurrentUser } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  try {
    const recoveryCodes = await enableMfa(user.userId, code);
    return NextResponse.json({ ok: true, recoveryCodes }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MfaError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('MFA enable failed', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'No pudimos activar MFA.' }, { status: 500 });
  }
}
