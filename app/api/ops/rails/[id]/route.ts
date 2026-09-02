import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { PlatformRailError } from '@/app/lib/platform/operating-mode';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { updateOfficialRailConnection } from '@/db/platform-rails';
import { touchPlatformOperator } from '@/db/organization';

async function update(request: Request, id: string) {
  try {
    const { user } = await authorizePlatformOperator(request, { mutation: true });
    await touchPlatformOperator(user.userId);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const row = await updateOfficialRailConnection(id, body);
    return NextResponse.json({ data: row }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof PlatformRailError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => update(request, (await params).id));
}
