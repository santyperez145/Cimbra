import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/runtime';
import { validateRuntimeConfiguration } from '@/app/lib/security/runtime-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = performance.now();
  const dependencies: Record<'database' | 'configuration', 'ok' | 'unavailable'> = {
    database: 'ok',
    configuration: 'ok',
  };

  try {
    validateRuntimeConfiguration();
  } catch (error) {
    dependencies.configuration = 'unavailable';
    console.error('Runtime configuration health check failed', error instanceof Error ? error.message : String(error));
  }

  try {
    const readiness = await getDatabase().prepare(
      "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.ledger_journals') IS NOT NULL AS ready",
    ).first<{ ready: boolean }>();
    if (!readiness?.ready) throw new Error('schema_not_ready');
  } catch (error) {
    dependencies.database = 'unavailable';
    console.error('Database health check failed', error instanceof Error ? error.message : String(error));
  }

  const healthy = Object.values(dependencies).every((state) => state === 'ok');
  return NextResponse.json({
    status: healthy ? 'ok' : 'degraded', service: 'cimbra-platform', version: '2026-08-29',
    dependencies, latencyMs: Math.round(performance.now() - startedAt), timestamp: new Date().toISOString(),
  }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
