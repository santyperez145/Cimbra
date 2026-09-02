import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { platformLiveReadiness } from '@/db/platform-rails';

async function getLiveReadiness(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'platform:read', capability: 'console.read' });
    const readiness = await platformLiveReadiness();
    return NextResponse.json({
      data: {
        requestedMode: readiness.requestedMode,
        effectiveMode: readiness.effectiveMode,
        liveReady: readiness.liveReady,
        liveBlocked: readiness.liveBlocked,
        blockReason: readiness.blockReason,
        goLive: readiness.goLive,
        environments: readiness.environments,
        products: readiness.products,
        rails: readiness.rails,
        fintechPath: readiness.fintechPath,
        capitalPlan: readiness.capitalPlan,
        references: readiness.references,
        summary: readiness.summary,
      },
      meta: {
        owner: 'Cimbra',
        competitorDependency: false,
        networkBoundary: 'direct_regulated_rails_only',
        graduation: 'integracion_homologacion_go_live',
      },
    }, { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => getLiveReadiness(request)); }
