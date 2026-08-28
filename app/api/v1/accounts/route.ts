import { GET as listAccounts, POST as createAccount } from '../../sandbox/accounts/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => listAccounts(request)); }
export function POST(request: Request) { return versionedApi(request, () => createAccount(request)); }
