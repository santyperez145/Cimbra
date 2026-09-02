import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { normalizeSupportStatusInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { touchPlatformOperator } from '@/db/organization';
import { platformSupportCaseOrganization, retrieveSupportCase, SupportError, updateSupportStatus } from '@/db/support';

async function retrieve(request: Request, id: string) {
  try {
    const { user } = await authorizePlatformOperator(request);
    await touchPlatformOperator(user.userId);
    const organizationId = await platformSupportCaseOrganization(id);
    return NextResponse.json({ data: await retrieveSupportCase(organizationId, id) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

async function update(request: Request, id: string) {
  try {
    const { user } = await authorizePlatformOperator(request, { mutation: true });
    await touchPlatformOperator(user.userId);
    const input = normalizeSupportStatusInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'Estado de soporte inválido.', code: 'invalid_support_status' }, { status: 400 });
    }
    const organizationId = await platformSupportCaseOrganization(id);
    const result = await updateSupportStatus({ organizationId, actor: user, idempotencyKey: null, id, status: input.status });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => retrieve(request, (await params).id));
}

export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => update(request, (await params).id));
}
