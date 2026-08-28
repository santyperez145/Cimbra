import { GET as getEvents } from '../../sandbox/events/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => getEvents(request)); }
