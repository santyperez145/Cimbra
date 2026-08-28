import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { mutationAllowed } from '@/app/lib/auth/http';
import { beginMfaSetup, MfaError } from '@/app/lib/auth/mfa';
import { getCurrentUser } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { currentPassword?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  try {
    const setup = await beginMfaSetup({ userId: user.userId, email: user.email, currentPassword });
    const qrDataUrl = await QRCode.toDataURL(setup.provisioningUri, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
    return NextResponse.json({ ...setup, qrDataUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MfaError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('MFA setup failed', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'No pudimos iniciar la configuración de MFA.' }, { status: 500 });
  }
}
