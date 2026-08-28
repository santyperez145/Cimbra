import { POST as createCard } from '../../sandbox/cards/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function POST(request: Request) { return versionedApi(request, () => createCard(request)); }
