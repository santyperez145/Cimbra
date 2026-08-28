import { POST as createAccount } from '../../sandbox/accounts/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request) { return versionedApi(request, () => createAccount(request)); }
