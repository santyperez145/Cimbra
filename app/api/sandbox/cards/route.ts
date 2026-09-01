import { NextResponse } from 'next/server';
import { sha256 } from '@/app/lib/auth/crypto';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from '@/app/lib/platform/authorization';
import { initialCardStatus, type CardFormat, type CardProduct } from '@/app/lib/platform/card-issuing';
import { scheduleWebhookDispatch } from '@/app/lib/platform/dispatch';
import { IdempotencyError, requestIdempotencyKey } from '@/app/lib/platform/idempotency';
import { decodePageCursor, pageLimit, paginatedResponse } from '@/app/lib/platform/pagination';
import { initializeCardIssuingRecords, CardIssuingError } from '@/db/card-issuing';
import { assertSandboxLedgerOrCertifiedRail } from '@/db/platform-rails';
import { ensureDatabase, getDatabase, OrganizationAccessError, recordAuditEvent } from '@/db/runtime';

export async function GET(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:read', capability: 'console.read' });
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    const cursor = decodePageCursor(url.searchParams.get('cursor'));
    if (limit === null || cursor === undefined) return NextResponse.json({ error: 'Paginación inválida.' }, { status: 400 });
    await ensureDatabase();
    const query = `SELECT c.id, c.program_id AS "programId", p.name AS "programName", c.account_id AS "accountId",
      c.customer_id AS "customerId", c.product, c.format, c.last4, c.status, c.status_reason AS "statusReason",
      c.activated_at AS "activatedAt", c.terminated_at AS "terminatedAt", c.created_at AS "createdAt",
      COALESCE(c.updated_at, c.created_at) AS "updatedAt"
      FROM cards c LEFT JOIN card_programs p ON p.id = c.program_id
      WHERE c.organization_id = ? ${cursor ? 'AND (c.created_at, c.id) < (?, ?)' : ''}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`;
    const statement = getDatabase().prepare(query);
    const rows = cursor
      ? await statement.bind(principal.organizationId, cursor.createdAt, cursor.id, limit + 1).all<Record<string, unknown> & { id: string; createdAt: string }>()
      : await statement.bind(principal.organizationId, limit + 1).all<Record<string, unknown> & { id: string; createdAt: string }>();
    return NextResponse.json(paginatedResponse(rows.results, limit), { headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) } });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authorizeApiRequest(request, { scope: 'cards:write', capability: 'finance.write', mutation: true });
    const { user, organizationId } = principal;
    const idempotencyKey = requestIdempotencyKey(request, principal);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !['accountId', 'programId', 'product', 'format'].includes(key))) {
      return NextResponse.json({ error: 'Datos de tarjeta inválidos.' }, { status: 400 });
    }
    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    const programId = typeof body?.programId === 'string' && body.programId.trim() ? body.programId.trim() : null;
    const requestedProduct = body?.product === undefined ? null : String(body.product);
    const requestedFormat = body?.format === undefined ? null : String(body.format);
    if (!accountId
      || (requestedProduct !== null && !['debit', 'credit', 'prepaid'].includes(requestedProduct))
      || (requestedFormat !== null && !['virtual', 'physical'].includes(requestedFormat))) {
      return NextResponse.json({ error: 'Datos de tarjeta inválidos.' }, { status: 400 });
    }
    await ensureDatabase();
    await assertSandboxLedgerOrCertifiedRail('card_issuing', CardIssuingError);
    const db = getDatabase();
    const account = await db.prepare(
      'SELECT id, customer_id AS customerId, currency FROM accounts WHERE id = ? AND organization_id = ? LIMIT 1',
    ).bind(accountId, organizationId).first<{ id: string; customerId: string; currency: 'ARS' | 'USD' | 'MXN' | 'COP' | 'BRL' | 'CLP' | 'PEN' }>();
    if (!account) return NextResponse.json({ error: 'La cuenta no pertenece a esta organización.' }, { status: 404 });
    const program = programId ? await db.prepare(
      `SELECT id, name, product, formats, default_currency AS "defaultCurrency", status
       FROM card_programs WHERE id = ? AND organization_id = ? LIMIT 1`,
    ).bind(programId, organizationId).first<{ id: string; name: string; product: CardProduct; formats: string; defaultCurrency: string; status: string }>() : null;
    if (programId && !program) return NextResponse.json({ error: 'Programa de tarjetas no encontrado.' }, { status: 404 });
    if (program?.status !== undefined && program.status !== 'active') return NextResponse.json({ error: 'El programa de tarjetas no está activo.' }, { status: 409 });
    let programFormats: CardFormat[] = [];
    if (program) {
      try {
        const parsed = JSON.parse(program.formats) as unknown;
        if (!Array.isArray(parsed) || parsed.some((value) => value !== 'virtual' && value !== 'physical')) throw new Error('invalid');
        programFormats = parsed as CardFormat[];
      } catch {
        return NextResponse.json({ error: 'La configuración del programa es inválida.' }, { status: 500 });
      }
    }
    const product = (requestedProduct ?? program?.product ?? 'debit') as CardProduct;
    const format = (requestedFormat ?? programFormats[0] ?? 'virtual') as CardFormat;
    if (program && (program.product !== product || !programFormats.includes(format))) {
      return NextResponse.json({ error: 'Producto o formato fuera del programa seleccionado.' }, { status: 409 });
    }
    if (program && program.defaultCurrency !== account.currency) {
      return NextResponse.json({ error: 'La moneda de la cuenta no coincide con el programa.' }, { status: 409 });
    }
    const id = crypto.randomUUID();
    const last4 = String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
    const createdAt = new Date().toISOString();
    const status = initialCardStatus(format);
    const requestFingerprint = await sha256(JSON.stringify({ accountId, programId, product, format }));
    const createdCard = { id, programId, programName: program?.name ?? null, accountId, customerId: account.customerId, product, format,
      last4, status, statusReason: 'issued', activatedAt: status === 'active' ? createdAt : null, terminatedAt: null, createdAt, updatedAt: createdAt };
    const result = await db.transaction(async (transaction) => {
      if (idempotencyKey) {
        await transaction.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))')
          .bind(`${organizationId}:card:${idempotencyKey}`).run();
        const existing = await transaction.prepare(
          `SELECT c.id, c.program_id AS "programId", p.name AS "programName", c.account_id AS "accountId",
            c.customer_id AS "customerId", c.product, c.format, c.last4, c.status, c.status_reason AS "statusReason",
            c.activated_at AS "activatedAt", c.terminated_at AS "terminatedAt", c.created_at AS "createdAt",
            COALESCE(c.updated_at, c.created_at) AS "updatedAt"
           FROM cards c LEFT JOIN card_programs p ON p.id = c.program_id
           WHERE c.organization_id = ? AND c.idempotency_key = ? LIMIT 1`,
        ).bind(organizationId, idempotencyKey).first<typeof createdCard>();
        if (existing) {
          if (existing.accountId !== accountId || existing.programId !== programId || existing.product !== product || existing.format !== format) {
            throw new IdempotencyError('Idempotency-Key ya fue usado con otros datos de tarjeta.', 409, 'idempotency_mismatch');
          }
          return { card: existing, replayed: true };
        }
      }
      await transaction.prepare(
        `INSERT INTO cards
          (id, organization_id, idempotency_key, program_id, account_id, customer_id, product, format, last4, status,
           status_reason, activated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
      ).bind(id, organizationId, idempotencyKey, programId, accountId, account.customerId, product, format, last4, status,
        status === 'active' ? createdAt : null, createdAt, createdAt).run();
      await initializeCardIssuingRecords(transaction, { organizationId, actor: user, cardId: id,
        idempotencyKey: idempotencyKey ?? `sandbox-card-create:${id}`,
        requestFingerprint, status, currency: account.currency, createdAt });
      await recordAuditEvent({ organizationId, actorId: user.userId, action: 'card.created', resourceType: 'card', resourceId: id,
        payload: { programId, product, format, status } }, transaction);
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
    if (error instanceof CardIssuingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof OrganizationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
