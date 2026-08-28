import { NextResponse } from 'next/server';
import { majorToMinor, normalizeCurrency } from '@/app/lib/ledger/money';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { versionedApi } from '@/app/lib/platform/versioned-api';
import { createRiskRule, RiskError, type RiskOperation, type RiskRuleAction, type RiskRuleKind } from '@/db/risk';

function normalizeConfiguration(kind: RiskRuleKind, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const configuration = value as Record<string, unknown>;
  if (kind === 'amount_threshold') {
    const currency = normalizeCurrency(configuration.currency);
    if (!currency) return null;
    try {
      const thresholdMinor = majorToMinor(configuration.threshold, currency);
      return thresholdMinor > 0n ? { currency, thresholdMinor: thresholdMinor.toString() } : null;
    } catch { return null; }
  }
  if (kind === 'counterparty_match') {
    const pattern = typeof configuration.pattern === 'string' ? configuration.pattern.trim().toLowerCase() : '';
    return pattern.length >= 2 && pattern.length <= 80 ? { pattern } : null;
  }
  const count = Number(configuration.count); const windowMinutes = Number(configuration.windowMinutes);
  return Number.isInteger(count) && count >= 2 && count <= 1000 && Number.isInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 10080
    ? { count, windowMinutes } : null;
}

async function createRule(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'risk:write', roles: ['owner', 'admin'], mutation: true });
    const idempotencyKey = requestIdempotencyKey(request, principal)!;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const kind = ['amount_threshold', 'velocity_count', 'counterparty_match'].includes(String(body?.kind)) ? body?.kind as RiskRuleKind : null;
    const operationType = ['any', 'transfer', 'cash_in', 'cash_out'].includes(String(body?.operationType)) ? body?.operationType as 'any' | RiskOperation : null;
    const action = ['score', 'review', 'decline'].includes(String(body?.action)) ? body?.action as RiskRuleAction : null;
    const scoreDelta = Number(body?.scoreDelta); const priority = Number(body?.priority ?? 100);
    const configuration = kind ? normalizeConfiguration(kind, body?.configuration) : null;
    if (name.length < 2 || !kind || !operationType || !action || !Number.isInteger(scoreDelta) || scoreDelta < 0 || scoreDelta > 100 ||
        !Number.isInteger(priority) || priority < 1 || priority > 1000 || !configuration) {
      return NextResponse.json({ error: 'Regla de riesgo inválida.', code: 'invalid_risk_rule' }, { status: 400 });
    }
    const result = await createRiskRule({ organizationId: principal.organizationId, actor: principal.user, idempotencyKey,
      name, kind, operationType, scoreDelta, action, configuration, priority });
    if (!result.replayed) scheduleWebhookDispatch(principal.organizationId);
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal) });
  } catch (error) {
    const authorization = authorizationErrorResponse(error);
    if (authorization) return authorization;
    if (error instanceof IdempotencyError || error instanceof RiskError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export function POST(request: Request) { return versionedApi(request, () => createRule(request)); }
