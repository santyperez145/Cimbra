import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createSettlementCycle, listSettlementCycles, SettlementError } from '@/db/settlements';

function scheduledDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  const normalized = new Date(value).toISOString();
  return Date.parse(normalized) <= Date.now() + 90 * 24 * 60 * 60 * 1000 ? normalized : undefined;
}

async function listCycles(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'settlements:read', capability: 'console.read' });
    return NextResponse.json({ data: await listSettlementCycles(principal.organizationId) }, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error); if (response) return response; throw error;
  }
}

async function createCycle(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'settlements:write', capability: 'reconciliation.write', mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const reconciliationRunId = typeof body?.reconciliationRunId === 'string' ? body.reconciliationRunId.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const scheduledFor = scheduledDate(body?.scheduledFor);
    if (!/^[0-9a-f-]{36}$/i.test(reconciliationRunId) || name.length < 2 || scheduledFor === undefined) {
      return NextResponse.json({ error: 'Ciclo de settlement inválido.', code: 'invalid_settlement_cycle' }, { status: 400 });
    }
    const result = await createSettlementCycle({ organizationId: principal.organizationId, actor: principal.user,
      idempotencyKey, reconciliationRunId, name, scheduledFor });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error); if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof SettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export function GET(request: Request) { return versionedApi(request, () => listCycles(request)); }
export function POST(request: Request) { return versionedApi(request, () => createCycle(request)); }
