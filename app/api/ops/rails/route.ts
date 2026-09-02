import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listOfficialRailsForOps } from '@/db/platform-rails';
import { touchPlatformOperator } from '@/db/organization';

async function list(request: Request) {
  try {
    const { user } = await authorizePlatformOperator(request);
    await touchPlatformOperator(user.userId);
    return NextResponse.json({ data: await listOfficialRailsForOps() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request) {
  return versionedApi(request, () => list(request));
}
