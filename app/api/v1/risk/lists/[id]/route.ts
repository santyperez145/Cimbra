import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { disableRiskListEntry } from '@/db/risk';

async function disableEntry(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.rules.manage', mutation: true });
    const { id } = await context.params;
    const disabled = await disableRiskListEntry(principal.organizationId, principal.user, id);
    if (!disabled) return NextResponse.json({ error: 'Entrada activa no encontrada.', code: 'risk_list_entry_not_found' }, { status: 404 });
    scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, id, status: 'disabled' }, { headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    throw error;
  }
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return versionedApi(request, () => disableEntry(request, context));
}
