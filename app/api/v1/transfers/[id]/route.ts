import { retrieveResource } from '@/app/lib/platform/resources';
import { versionedApi } from '@/app/lib/platform/versioned-api';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return versionedApi(request, () => retrieveResource(request, id, 'transfer'));
}
