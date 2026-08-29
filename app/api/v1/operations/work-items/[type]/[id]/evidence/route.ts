import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { requestIdempotencyKey, IdempotencyError } from '@/app/lib/platform/idempotency';
import { normalizeEvidenceLink } from '@/app/lib/platform/operations-input';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { linkOperationalEvidence, OperationsError, workItemType } from '@/db/operations';

async function linkEvidence(request: Request, routeType: string, id: string) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'operations:write', capability: 'operations.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const type = workItemType(routeType);
    const documentId = normalizeEvidenceLink(await request.json().catch(() => null));
    if (!type) return NextResponse.json({ error: 'Tipo de caso operativo inválido.', code: 'invalid_work_item_type' }, { status: 400 });
    if (!documentId) return NextResponse.json({ error: 'Documento de evidencia inválido.', code: 'invalid_evidence_link' }, { status: 400 });
    const result = await linkOperationalEvidence({ organizationId: principal.organizationId, actor: principal.user,
      type, id, idempotencyKey, documentId });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof OperationsError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function POST(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  return versionedApi(request, async () => { const value = await params; return linkEvidence(request, value.type, value.id); });
}
