import { NextResponse } from 'next/server';
import { ensureDatabase, getD1 } from '@/db/runtime';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const company = typeof body?.company === 'string' ? body.company.trim().slice(0, 120) : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 180) : '';
  const volume = typeof body?.volume === 'string' ? body.volume.trim().slice(0, 50) : '';
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  if (name.length < 2 || company.length < 2 || !emailPattern.test(email) || !volume) {
    return NextResponse.json({ error: 'Revisá los campos requeridos.' }, { status: 400 });
  }
  await ensureDatabase();
  const db = getD1();
  const duplicate = await db.prepare(
    `SELECT id FROM leads WHERE email = ? AND created_at > datetime('now', '-5 minutes') LIMIT 1`,
  ).bind(email).first();
  if (!duplicate) {
    await db.prepare(
      'INSERT INTO leads (id, name, company, email, volume, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), name, company, email, volume, message, 'new', new Date().toISOString()).run();
  }
  return NextResponse.json({ ok: true, message: 'Recibimos tu solicitud. Te contactaremos para diseñar el alcance.' });
}
