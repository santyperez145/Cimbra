import { after } from 'next/server';
import { dispatchWebhookDeliveries } from '@/db/platform';
import { processPayoutBatchById } from '@/db/payouts';

export function scheduleWebhookDispatch(organizationId: string) {
  after(async () => {
    try {
      await dispatchWebhookDeliveries({ organizationId, limit: 10 });
    } catch (error) {
      console.error('Webhook dispatch failed', error instanceof Error ? error.message : 'unknown error');
    }
  });
}

export function schedulePayoutBatchProcessing(organizationId: string, batchId: string) {
  after(async () => {
    try {
      await processPayoutBatchById(organizationId, batchId);
      await dispatchWebhookDeliveries({ organizationId, limit: 25 });
    } catch (error) {
      console.error('Payout batch processing failed', error instanceof Error ? error.message : 'unknown error');
    }
  });
}
