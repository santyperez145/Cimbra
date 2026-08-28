import { NextResponse } from 'next/server';
import { serializeTransaction } from '@/db/ledger';
import { ensureDatabase, getDatabase } from '@/db/runtime';
import { authorizationErrorResponse, authorizeApiRequest, rateLimitHeaders } from './authorization';
import type { ApiScope } from './scopes';

type ResourceName = 'customer' | 'account' | 'card' | 'transfer';

const resources: Record<ResourceName, { scope: ApiScope; query: string }> = {
  customer: {
    scope: 'customers:read',
    query: `SELECT id, type, name, country, tax_id_last4 AS "taxIdLast4", status, created_at AS "createdAt"
      FROM customers WHERE id = ? AND organization_id = ? LIMIT 1`,
  },
  account: {
    scope: 'accounts:read',
    query: `SELECT a.id, a.customer_id AS "customerId", a.currency, a.country, a.account_reference AS "accountReference",
      COALESCE(SUM(CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS "balanceMinor",
      a.status, a.created_at AS "createdAt"
      FROM accounts a JOIN financial_accounts f ON f.id = a.ledger_account_id
      LEFT JOIN ledger_postings p ON p.account_id = f.id
      WHERE a.id = ? AND a.organization_id = ? GROUP BY a.id, f.normal_balance LIMIT 1`,
  },
  card: {
    scope: 'cards:read',
    query: `SELECT id, account_id AS "accountId", customer_id AS "customerId", product, format, last4, status, created_at AS "createdAt"
      FROM cards WHERE id = ? AND organization_id = ? LIMIT 1`,
  },
  transfer: {
    scope: 'transfers:read',
    query: `SELECT id, counterparty, description, amount_minor::text AS "amountMinor", currency, status,
      risk_score AS "riskScore", reversal_of AS "reversalOf", created_at AS "createdAt"
      FROM transactions WHERE id = ? AND organization_id = ? LIMIT 1`,
  },
};

export async function retrieveResource(request: Request, id: string, name: ResourceName) {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'El identificador del recurso es inválido.' }, { status: 400 });
    }
    const definition = resources[name];
    const principal = await authorizeApiRequest(request, { scope: definition.scope, roles: ['owner', 'admin', 'operator', 'viewer'] });
    await ensureDatabase();
    const item = await getDatabase().prepare(definition.query).bind(id, principal.organizationId).first<Record<string, unknown>>();
    if (!item) return NextResponse.json({ error: 'Recurso no encontrado.' }, { status: 404, headers: rateLimitHeaders(principal) });
    return NextResponse.json(name === 'transfer' ? serializeTransaction(item as Parameters<typeof serializeTransaction>[0]) : item, {
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(principal) },
    });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
