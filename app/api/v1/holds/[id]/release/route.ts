import { POST as releaseHold } from '../../../../sandbox/holds/[id]/release/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => releaseHold(request, context));
}
