import { after } from 'next/server';
import { dispatchWebhookDeliveries } from '@/db/platform';

export function scheduleWebhookDispatch(organizationId: string) {
  after(async () => {
    try {
      await dispatchWebhookDeliveries({ organizationId, limit: 10 });
    } catch (error) {
      console.error('Webhook dispatch failed', error instanceof Error ? error.message : 'unknown error');
    }
  });
}
