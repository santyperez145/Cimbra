import { POST as reverse } from '../../../../sandbox/book-transfers/[id]/reverse/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return versionedApi(request, () => reverse(request, context)); }
