import { GET as listWebhooks, POST as createWebhook } from '../../platform/webhooks/route';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export function GET(request: Request) { return versionedApi(request, () => listWebhooks(request)); }
export function POST(request: Request) { return versionedApi(request, () => createWebhook(request)); }
