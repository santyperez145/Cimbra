import { GET as statement } from '../../../../sandbox/accounts/[id]/statement/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return versionedApi(request, () => statement(request, context)); }
