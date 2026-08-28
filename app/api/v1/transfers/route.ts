import { POST as createTransfer } from '../../sandbox/transfers/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request) { return versionedApi(request, () => createTransfer(request)); }
