import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { type RiskListCategory, type RiskSubjectType } from '@/app/lib/platform/risk-signals';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createRiskListEntry, RiskError } from '@/db/risk';

async function createEntry(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', capability: 'risk.rules.manage', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const subjectType = ['counterparty', 'device', 'identity'].includes(String(body?.subjectType)) ? body?.subjectType as RiskSubjectType : null;
    const category = ['allow', 'watch', 'block'].includes(String(body?.category)) ? body?.category as RiskListCategory : null;
    const subjectValue = typeof body?.subjectValue === 'string' ? body.subjectValue.trim() : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const expiresAt = body?.expiresAt === undefined || body.expiresAt === null || body.expiresAt === '' ? null
      : typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt)) ? new Date(body.expiresAt).toISOString() : undefined;
    if (!subjectType || !category || subjectValue.length < 2 || subjectValue.length > 160 || reason.length < 3 || reason.length > 240
      || expiresAt === undefined || (expiresAt !== null && Date.parse(expiresAt) <= Date.now())) {
      return NextResponse.json({ error: 'Entrada de lista inválida.', code: 'invalid_risk_list_entry' }, { status: 400 });
    }
    const result = await createRiskListEntry({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      subjectType, subjectValue, category, reason, expiresAt });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createEntry(request)); }
