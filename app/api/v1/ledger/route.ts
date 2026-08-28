import { GET as getLedger } from '../../sandbox/ledger/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => getLedger(request)); }
