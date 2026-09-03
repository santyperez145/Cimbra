import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { serviceTopology } from '@/app/lib/platform/service-catalog';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { listPlatformLeads, listPlatformTenants, touchPlatformOperator } from '@/db/organization';
import { listOfficialRailsForOps, platformLiveReadiness } from '@/db/platform-rails';
import { platformCapitalPlan } from '@/db/capital';
import { listPlatformSupportCases } from '@/db/support';

async function overview(request: Request) {
  try {
    const { user, role } = await authorizePlatformOperator(request);
    await touchPlatformOperator(user.userId);
    const [tenants, leads, supportCases, readiness, rails, capital] = await Promise.all([
      listPlatformTenants(), listPlatformLeads(), listPlatformSupportCases(),
      platformLiveReadiness(), listOfficialRailsForOps(), platformCapitalPlan(),
    ]);
    return NextResponse.json({
      data: {
        operator: { email: user.email, role },
        tenants,
        leads,
        supportCases,
        services: serviceTopology(),
        rails,
        capital,
        readiness: {
          effectiveMode: readiness.effectiveMode,
          liveReady: readiness.liveReady,
          blockReason: readiness.blockReason,
          fintechPath: readiness.fintechPath,
        },
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => overview(request)); }
