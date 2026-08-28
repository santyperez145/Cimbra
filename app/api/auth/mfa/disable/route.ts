import { NextResponse } from 'next/server';
import { mutationAllowed } from '@/app/lib/auth/http';
import { disableMfa, MfaError } from '@/app/lib/auth/mfa';
import { getCurrentUser } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { currentPassword?: unknown; code?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 40) : '';
  try {
    await disableMfa({ userId: user.userId, currentPassword, code });
    return NextResponse.json({ ok: true, signedOut: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MfaError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('MFA disable failed', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'No pudimos desactivar MFA.' }, { status: 500 });
  }
}
