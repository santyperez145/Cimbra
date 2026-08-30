import { GET as retrieve } from '../../../sandbox/book-transfers/[id]/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return versionedApi(request, () => retrieve(request, context)); }
