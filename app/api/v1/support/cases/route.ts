import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { normalizeSupportCaseInput } from '@/app/lib/platform/support-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createSupportCase, listSupportCases, SupportError } from '@/db/support';

async function list(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'support:read', capability: 'support.read' });
    return NextResponse.json({ data: await listSupportCases(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    throw error;
  }
}

async function create(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'support:write', capability: 'support.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const input = normalizeSupportCaseInput(await request.json().catch(() => null));
    if (!input) {
      return NextResponse.json({ error: 'Datos del caso de soporte inválidos.', code: 'invalid_support_case' }, { status: 400 });
    }
    const result = await createSupportCase({
      organizationId: principal.organizationId, actor: principal.user, idempotencyKey, ...input,
    });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof SupportError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => list(request)); }
export function POST(request: Request) { return versionedApi(request, () => create(request)); }
