import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { disableRiskRule } from '@/db/risk';

async function disableRule(request: Request, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', roles: ['owner', 'admin'], mutation: true });
    const disabled = await disableRiskRule(principal.organizationId, principal.user, id);
    if (!disabled) return NextResponse.json({ error: 'Regla no encontrada o ya deshabilitada.', code: 'risk_rule_not_found' }, { status: 404 });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => disableRule(request, (await params).id));
}
