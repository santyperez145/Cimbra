import { dispatchWebhookDeliveries } from '@/db/platform';
import { processDueSettlementCycles } from '@/db/approvals';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settlements = await processDueSettlementCycles(25);
  const results = await dispatchWebhookDeliveries({ limit: 25 });
  return Response.json({ ok: true, processed: results.length, results, settlements }, { headers: { 'Cache-Control': 'no-store' } });
}
