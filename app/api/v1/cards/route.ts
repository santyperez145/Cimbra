import { GET as listCards, POST as createCard } from '../../sandbox/cards/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => listCards(request)); }
export function POST(request: Request) { return versionedApi(request, () => createCard(request)); }
