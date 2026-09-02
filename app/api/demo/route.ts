import { NextResponse } from 'next/server';
import { composeLeadMessage, normalizeDemoIntent } from '@/app/lib/platform/capital-plan';
import { ensureDatabase, getDatabase } from '@/db/runtime';
import { mutationAllowed } from '@/app/lib/auth/http';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return NextResponse.json({ error: 'Origen de solicitud no permitido.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const company = typeof body?.company === 'string' ? body.company.trim().slice(0, 120) : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 180) : '';
  const volume = typeof body?.volume === 'string' ? body.volume.trim().slice(0, 50) : '';
  const intent = normalizeDemoIntent(body?.intent);
  const message = composeLeadMessage(intent, typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : '');
  if (name.length < 2 || company.length < 2 || !emailPattern.test(email) || !volume) {
    return NextResponse.json({ error: 'Revisá los campos requeridos.' }, { status: 400 });
  }
  await ensureDatabase();
  const db = getDatabase();
  const duplicate = await db.prepare(
    'SELECT id FROM leads WHERE email = ? AND created_at > ? LIMIT 1',
  ).bind(email, new Date(Date.now() - 5 * 60 * 1000).toISOString()).first();
  if (!duplicate) {
    await db.prepare(
      'INSERT INTO leads (id, name, company, email, volume, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), name, company, email, volume, message, 'new', new Date().toISOString()).run();
  }
  return NextResponse.json({ ok: true, message: 'Recibimos tu solicitud. Te contactaremos para diseñar el alcance.' });
}
