import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { authorizePlatformOperator } from '@/app/lib/platform/platform-ops';
import { normalizeSupportMessageInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { touchPlatformOperator } from '@/db/organization';
import { addSupportMessage, platformSupportCaseOrganization, SupportError } from '@/db/support';

async function reply(request: Request, id: string) {
  try {
    const { user } = await authorizePlatformOperator(request, { mutation: true });
    await touchPlatformOperator(user.userId);
    const input = normalizeSupportMessageInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'El mensaje debe tener entre 3 y 4000 caracteres.', code: 'invalid_support_message' }, { status: 400 });
    }
    const organizationId = await platformSupportCaseOrganization(id);
    const result = await addSupportMessage({
      organizationId, actor: user, idempotencyKey: null, id, body: input.body, authorKind: 'platform',
    });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return versionedApi(request, async () => reply(request, (await params).id));
}
