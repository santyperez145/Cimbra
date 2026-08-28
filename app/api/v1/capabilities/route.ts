import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { PLATFORM_CAPABILITIES, PLATFORM_SUMMARY } from '@/app/lib/platform/capabilities';
import { versionedApi } from '@/app/lib/platform/versioned-api';

async function listCapabilities(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'platform:read' });
    return NextResponse.json({ data: PLATFORM_CAPABILITIES, meta: PLATFORM_SUMMARY }, {
      headers: { 'Cache-Control': 'private, max-age=300', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listCapabilities(request)); }
