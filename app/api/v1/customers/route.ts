import { GET as listCustomers, POST as createCustomer } from '../../sandbox/customers/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => listCustomers(request)); }
export function POST(request: Request) { return versionedApi(request, () => createCustomer(request)); }
