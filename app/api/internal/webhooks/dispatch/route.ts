import { dispatchWebhookDeliveries } from '@/db/platform';
import { processDueSettlementCycles } from '@/db/approvals';
import { expireRiskStepUpChallenges } from '@/db/risk';
import { expireDueDiligenceCases } from '@/db/due-diligence';
import { processDueRecurringMandates } from '@/db/billers';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const expiredStepUps = await expireRiskStepUpChallenges(250);
  const expiredDueDiligence = await expireDueDiligenceCases(250);
  const recurringMandates = await processDueRecurringMandates(50);
  const settlements = await processDueSettlementCycles(25);
  const results = await dispatchWebhookDeliveries({ limit: 25 });
  return Response.json({ ok: true, processed: results.length, results, settlements, recurringMandates, expiredStepUps, expiredDueDiligence }, { headers: { 'Cache-Control': 'no-store' } });
}
