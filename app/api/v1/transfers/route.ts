import { GET as listTransfers, POST as createTransfer } from '../../sandbox/transfers/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => listTransfers(request)); }
export function POST(request: Request) { return versionedApi(request, () => createTransfer(request)); }
