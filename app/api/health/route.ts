import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/runtime';
import { platformLiveReadiness } from '@/db/platform-rails';
import { evaluateLiveReadiness } from '@/app/lib/platform/live-readiness';
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
      `SELECT to_regclass('public.users') IS NOT NULL
        AND to_regclass('public.ledger_journals') IS NOT NULL
        AND to_regclass('public.billers') IS NOT NULL
        AND to_regclass('public.bill_payment_orders') IS NOT NULL
        AND to_regclass('public.recurring_payment_mandates') IS NOT NULL
        AND to_regclass('public.payout_beneficiaries') IS NOT NULL
        AND to_regclass('public.payout_batches') IS NOT NULL
        AND to_regclass('public.payout_items') IS NOT NULL
        AND to_regclass('public.book_transfers') IS NOT NULL
        AND to_regclass('public.wallet_programs') IS NOT NULL
        AND to_regclass('public.wallets') IS NOT NULL
        AND to_regclass('public.wallet_pockets') IS NOT NULL
        AND to_regclass('public.rail_instruments') IS NOT NULL
        AND to_regclass('public.instant_transfers') IS NOT NULL
        AND to_regclass('public.payment_qrs') IS NOT NULL
        AND to_regclass('public.qr_sale_orders') IS NOT NULL
        AND to_regclass('public.qr_debts') IS NOT NULL
        AND to_regclass('public.payment_links') IS NOT NULL
        AND to_regclass('public.collection_tills') IS NOT NULL
        AND to_regclass('public.echeqs') IS NOT NULL
        AND to_regclass('public.platform_rails') IS NOT NULL
        AND to_regclass('public.official_rail_connections') IS NOT NULL AS ready`,
    ).first<{ ready: boolean }>();
    if (!readiness?.ready) throw new Error('schema_not_ready');
  } catch (error) {
    dependencies.database = 'unavailable';
    console.error('Database health check failed', error instanceof Error ? error.message : String(error));
  }

  const live = dependencies.database === 'ok'
    ? await platformLiveReadiness()
    : evaluateLiveReadiness();
  const healthy = Object.values(dependencies).every((state) => state === 'ok');
  return NextResponse.json({
    status: healthy ? 'ok' : 'degraded', service: 'cimbra-platform', version: '2026-09-01',
    environment: live.effectiveMode, requestedEnvironment: live.requestedMode, liveReady: live.liveReady,
    liveBlocked: live.liveBlocked, blockReason: live.blockReason,
    dependencies, latencyMs: Math.round(performance.now() - startedAt), timestamp: new Date().toISOString(),
  }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store', 'Cimbra-Environment': live.effectiveMode } });
}
