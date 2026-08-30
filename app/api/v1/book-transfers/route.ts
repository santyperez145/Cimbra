import { GET as list, POST as create } from '../../sandbox/book-transfers/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';
export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
