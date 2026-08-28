import { NextResponse } from 'next/server';
import { mutationAllowed } from '@/app/lib/auth/http';
import { destroySession } from '@/app/lib/auth/session';

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  await destroySession(request, response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
