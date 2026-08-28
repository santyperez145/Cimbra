import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/app/lib/auth/session';

export async function GET(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: 'Autenticación requerida.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ user: { username: user.username, displayName: user.displayName, email: user.email, emailVerified: user.emailVerified } }, { headers: { 'Cache-Control': 'no-store' } });
}
