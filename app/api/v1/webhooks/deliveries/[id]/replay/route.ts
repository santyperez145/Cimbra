import { POST as replayDelivery } from '../../../../../platform/webhooks/deliveries/[id]/replay/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => replayDelivery(request, context));
}
