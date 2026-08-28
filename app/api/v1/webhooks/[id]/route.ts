import { DELETE as disableWebhook } from '../../../platform/webhooks/[id]/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => disableWebhook(request, context));
}
