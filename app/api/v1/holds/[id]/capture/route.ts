import { POST as captureHold } from '../../../../sandbox/holds/[id]/capture/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => captureHold(request, context));
}
