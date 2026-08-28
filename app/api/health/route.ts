import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = performance.now();
  try {
    const readiness = await getDatabase().prepare(
      "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.ledger_journals') IS NOT NULL AS ready",
    ).first<{ ready: boolean }>();
    if (!readiness?.ready) throw new Error('schema_not_ready');
    return NextResponse.json({
      status: 'ok', service: 'cimbra-platform', version: '2026-08-28',
      dependencies: { database: 'ok' }, latencyMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({
      status: 'degraded', service: 'cimbra-platform', dependencies: { database: 'unavailable' },
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
