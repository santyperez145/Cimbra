import { NextResponse } from 'next/server';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

const countries = new Set(['AR', 'MX', 'CO', 'BR', 'CL', 'PE']);

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'customers:read', capability: 'console.read' });
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.' }, { status: 400 });
    await ensureDatabase();
    const query = `SELECT id, type, name, country, tax_id_last4 AS "taxIdLast4", status, created_at AS "createdAt"
      FROM customers WHERE organization_id = ? ${cursor ? 'AND (created_at, id) < (?, ?)' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`;
    const statement = getDatabase().prepare(query);
    const rows = cursor
      ? await statement.bind(principal.organizationId, cursor.createdAt, cursor.id, limit + 1).all<{ id: string; type: string; name: string; country: string; taxIdLast4: string; status: string; createdAt: string }>()
      : await statement.bind(principal.organizationId, limit + 1).all<{ id: string; type: string; name: string; country: string; taxIdLast4: string; status: string; createdAt: string }>();
    return NextResponse.json(paginatedResponse(rows.results, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'customers:write', capability: 'finance.write', mutation: true });
    const { user, organizationId } = principal;
    const idempotencyKey = requestIdempotencyKey(request, principal);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const type = body?.type === undefined ? 'individual' : body.type;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 140) : '';
    const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
    const taxId = typeof body?.taxId === 'string' ? body.taxId.replace(/\D/g, '').slice(-20) : '';
    const taxIdLast4 = taxId.slice(-4);
    if (!['individual', 'business'].includes(String(type)) || name.length < 2 || !countries.has(country) || taxId.length < 4) {
      return NextResponse.json({ error: 'Datos de cliente inválidos.' }, { status: 400 });
    }
    await ensureDatabase();
    const customer = { id: crypto.randomUUID(), type: String(type), name, country, taxIdLast4: taxId.slice(-4), status: 'active', createdAt: new Date().toISOString() };
    const result = await getDatabase().transaction(async (transaction) => {
      if (idempotencyKey) {
        await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
          .bind(`${organizationId}:customer:${idempotencyKey}`).run();
        const existing = await transaction.prepare(
          `SELECT id, type, name, country, tax_id_last4 AS "taxIdLast4", status, created_at AS "createdAt"
           FROM customers WHERE organization_id = ? AND idempotency_key = ? LIMIT 1`,
        ).bind(organizationId, idempotencyKey).first<typeof customer>();
        if (existing) {
          if (existing.type !== String(type) || existing.name !== name || existing.country !== country || existing.taxIdLast4 !== taxIdLast4) {
            throw new IdempotencyError('Idempotency-Key ya fue usado con otros datos de cliente.', 409, 'idempotency_mismatch');
          }
          return { customer: existing, replayed: true };
        }
      }
      await transaction.prepare(
        `INSERT INTO customers
          (id, organization_id, idempotency_key, type, name, country, tax_id_last4, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(customer.id, organizationId, idempotencyKey, customer.type, customer.name, customer.country, customer.taxIdLast4, customer.status, customer.createdAt).run();
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'customer.created', resourceType: 'customer', resourceId: customer.id, payload: { type, country } }, transaction);
      return { customer, replayed: false };
    });
    if (!result.replayed) scheduleWebhookDispatch(organizationId);
    return NextResponse.json({ ok: true, customer: result.customer, replayed: result.replayed }, {
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
