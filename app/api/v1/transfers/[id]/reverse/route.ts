import { POST as reverseTransfer } from '../../../../sandbox/transfers/[id]/reverse/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => reverseTransfer(request, context));
}
