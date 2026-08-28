import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', roles: ['owner', 'admin', 'operator', 'viewer'] });
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.' }, { status: 400 });
    await ensureDatabase();
    const query = `SELECT id, account_id AS "accountId", customer_id AS "customerId", product, format, last4, status, created_at AS "createdAt"
      FROM cards WHERE organization_id = ? ${cursor ? 'AND (created_at, id) < (?, ?)' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`;
    const statement = getDatabase().prepare(query);
    const rows = cursor
      ? await statement.bind(principal.organizationId, cursor.createdAt, cursor.id, limit + 1).all<{ id: string; accountId: string; customerId: string; product: string; format: string; last4: string; status: string; createdAt: string }>()
      : await statement.bind(principal.organizationId, limit + 1).all<{ id: string; accountId: string; customerId: string; product: string; format: string; last4: string; status: string; createdAt: string }>();
    return NextResponse.json(paginatedResponse(rows.results, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:write', roles: ['owner', 'admin', 'operator'], mutation: true });
    const { user, organizationId } = principal;
    const idempotencyKey = requestIdempotencyKey(request, principal);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const product = body?.product === undefined ? 'debit' : String(body.product);
    const format = body?.format === undefined ? 'virtual' : String(body.format);
    if (!accountId || !['debit', 'credit', 'prepaid'].includes(product) || !['virtual', 'physical'].includes(format)) {
      return NextResponse.json({ error: 'Datos de tarjeta inválidos.' }, { status: 400 });
    }
    await ensureDatabase();
    const db = getDatabase();
    const account = await db.prepare('SELECT id, customer_id AS customerId FROM accounts WHERE id = ? AND organization_id = ? LIMIT 1').bind(accountId, organizationId).first<{ id: string; customerId: string }>();
    if (!account) return NextResponse.json({ error: 'La cuenta no pertenece a esta organización.' }, { status: 404 });
    const id = crypto.randomUUID();
    const last4 = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
    const createdAt = new Date().toISOString();
    const createdCard = { id, accountId, customerId: account.customerId, product, format, last4, status: 'active', createdAt };
    const result = await db.transaction(async (transaction) => {
      if (idempotencyKey) {
        await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
          .bind(`${organizationId}:card:${idempotencyKey}`).run();
        const existing = await transaction.prepare(
          `SELECT id, account_id AS "accountId", customer_id AS "customerId", product, format, last4,
            status, created_at AS "createdAt"
           FROM cards WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
        ).bind(organizationId, idempotencyKey).first<typeof createdCard>();
        if (existing) {
          if (existing.accountId !== accountId || existing.product !== product || existing.format !== format) {
            throw new IdempotencyError('Idempotency-Key ya fue usado con otros datos de tarjeta.', 409, 'idempotency_mismatch');
          }
          return { card: existing, replayed: true };
        }
      }
      await transaction.prepare(
        `INSERT INTO cards
          (id, organization_id, idempotency_key, account_id, customer_id, product, format, last4, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, organizationId, idempotencyKey, accountId, account.customerId, product, format, last4, 'active', createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'card.created', resourceType: 'card', resourceId: id, payload: { product, format } }, transaction);
      return { card: createdCard, replayed: false };
    });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, card: result.card, replayed: result.replayed }, {
      status: result.replayed ? 200 : 201, headers: rateLimitHeaders(principal),
    });
  } catch (error) {
    const authorizationResponse = authorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof IdempotencyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
