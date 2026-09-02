import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { normalizeLeadStatusInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { OrganizationAdminError, touchPlatformOperator, updatePlatformLead } from '@/db/organization';

async function update(request: Request, id: string) {
  try {
    const { user } = await authorizePlatformOperator(request, { mutation: true });
    await touchPlatformOperator(user.userId);
    const input = normalizeLeadStatusInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'Estado de lead inválido.', code: 'invalid_lead_status' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await updatePlatformLead(id, input.status)) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof OrganizationAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => update(request, (await params).id));
}
