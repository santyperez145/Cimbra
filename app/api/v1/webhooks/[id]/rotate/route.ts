import { POST as rotateWebhook } from '../../../../platform/webhooks/[id]/rotate/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => rotateWebhook(request, context));
}
