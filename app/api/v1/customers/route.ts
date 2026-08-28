import { POST as createCustomer } from '../../sandbox/customers/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request) { return versionedApi(request, () => createCustomer(request)); }
