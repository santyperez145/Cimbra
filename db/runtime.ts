import type { AuthUser } from '@/app/lib/auth/types';
import type { Currency } from '@/app/lib/ledger/money';
import { minorToMajorNumber } from '@/app/lib/ledger/money';
import { getDatabaseClient } from './client';
import { getLedgerBalances, listActiveHolds, seedOrganizationLedger, serializeTransaction, type ActiveHold, type LedgerBalance } from './ledger';

export type DashboardTransaction = {
  id: string;
  counterparty: string;
  description: string;
  amount: number;
  amountMinor: string;
  currency: Currency;
  status: string;
  riskScore: number;
  reversalOf: string | null;
  createdAt: string;
};

export type DashboardData = {
  organizationId: string;
  organizationName: string;
  environment: string;
  balance: number;
  processedThisMonth: number;
  approvalRate: number;
  transactionCount: number;
  activeAccounts: number;
  riskAlerts: number;
  journalCount: number;
  cards: Array<{
    id: string;
    product: string;
    format: string;
    last4: string;
    status: string;
    createdAt: string;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    status: string;
    createdAt: string;
  }>;
  balances: LedgerBalance[];
  holds: ActiveHold[];
  transactions: DashboardTransaction[];
};

export type OrganizationRole = 'owner' | 'admin' | 'operator' | 'viewer';

export class OrganizationAccessError extends Error {
  readonly status = 403;
}

let schemaReady: Promise<void> | null = null;

export function getDatabase() {
  return getDatabaseClient();
}

export function ensureDatabase(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getDatabase().prepare('SELECT 1 FROM users LIMIT 1').all()
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

export async function getOrganizationContext(user: AuthUser) {
  await ensureDatabase();
  const database = getDatabase();
  let member = await database.prepare(
    `SELECT organization_id AS organizationId, role FROM members
     WHERE external_user_id = ? LIMIT 1`,
  ).bind(user.userId).first<{ organizationId: string; role: OrganizationRole }>();
  if (!member) {
    const now = new Date().toISOString();
    const organizationId = crypto.randomUUID();
    const safeBase = user.email.split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'workspace';
    try {
      await database.transaction(async (transaction) => {
        await transaction.prepare(
          'INSERT INTO organizations (id, name, slug, country, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(organizationId, 'Cimbra Sandbox', `${safeBase}-${organizationId.slice(0, 6)}`, 'AR', 'sandbox', now).run();
        await transaction.prepare(
          'INSERT INTO members (id, organization_id, external_user_id, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), organizationId, user.userId, user.email, 'owner', now).run();
      });
      member = { organizationId, role: 'owner' };
    } catch (error) {
      member = await database.prepare(
        'SELECT organization_id AS organizationId, role FROM members WHERE external_user_id = ? LIMIT 1',
      ).bind(user.userId).first<{ organizationId: string; role: OrganizationRole }>();
      if (!member) throw error;
    }
  }
  await seedOrganizationLedger(member.organizationId);
  return member;
}

export async function getOrCreateOrganization(user: AuthUser) {
  return (await getOrganizationContext(user)).organizationId;
}

export async function requireOrganizationRole(user: AuthUser, allowed: readonly OrganizationRole[]) {
  const context = await getOrganizationContext(user);
  if (!allowed.includes(context.role)) throw new OrganizationAccessError('Tu rol no permite ejecutar esta operación.');
  return context;
}

export async function getDashboardData(user: AuthUser): Promise<DashboardData> {
  const { organizationId } = await getOrganizationContext(user);
  const database = getDatabase();
  const organization = await database.prepare('SELECT name, status FROM organizations WHERE id = ? LIMIT 1')
    .bind(organizationId).first<{ name: string; status: string }>();
  const transactionRows = await database.prepare(
    `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
      risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
     FROM transactions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 12`,
  ).bind(organizationId).all<{
    id: string; counterparty: string; description: string; amountMinor: string; currency: Currency;
    status: string; riskScore: number; reversalOf: string | null; createdAt: string;
  }>();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const summary = await database.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN currency = 'ARS' AND status IN ('settled', 'reversed') THEN ABS(amount_minor) ELSE 0 END), 0)::text AS processedMinor,
      COALESCE(AVG(CASE WHEN status IN ('settled', 'authorized', 'reversed') THEN 100.0 ELSE 0 END), 0) AS approval,
      COUNT(*)::int AS transactionCount
     FROM transactions WHERE organization_id = ? AND created_at >= ?`,
  ).bind(organizationId, monthStart.toISOString()).first<{ processedMinor: string; approval: number; transactionCount: number }>();
  const accountCount = await database.prepare(
    "SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id = ? AND status = 'active'",
  ).bind(organizationId).first<{ count: number }>();
  const [balances, holds, cardRows, documentRows, journalSummary] = await Promise.all([
    getLedgerBalances(organizationId),
    listActiveHolds(organizationId),
    database.prepare(
      `SELECT id, product, format, last4, status, created_at AS "createdAt"
       FROM cards WHERE organization_id = ? ORDER BY created_at DESC LIMIT 25`,
    ).bind(organizationId).all<{
      id: string; product: string; format: string; last4: string; status: string; createdAt: string;
    }>(),
    database.prepare(
      `SELECT id, file_name AS "fileName", content_type AS "contentType", size, status, created_at AS "createdAt"
       FROM compliance_documents WHERE organization_id = ? ORDER BY created_at DESC LIMIT 25`,
    ).bind(organizationId).all<{
      id: string; fileName: string; contentType: string; size: number; status: string; createdAt: string;
    }>(),
    database.prepare(
      'SELECT COUNT(*)::int AS count FROM ledger_journals WHERE organization_id = ?',
    ).bind(organizationId).first<{ count: number }>(),
  ]);
  const primaryBalance = balances.find((balance) => balance.currency === 'ARS') ?? balances[0];
  return {
    organizationId,
    organizationName: organization?.name ?? 'Mi organización',
    environment: organization?.status ?? 'sandbox',
    balance: primaryBalance?.available ?? 0,
    processedThisMonth: minorToMajorNumber(summary?.processedMinor ?? '0', 'ARS'),
    approvalRate: Number(summary?.approval ?? 0),
    transactionCount: Number(summary?.transactionCount ?? 0),
    activeAccounts: Number(accountCount?.count ?? 0),
    riskAlerts: holds.length,
    journalCount: Number(journalSummary?.count ?? 0),
    cards: cardRows.results,
    documents: documentRows.results,
    balances,
    holds,
    transactions: transactionRows.results.map((transaction) => serializeTransaction(transaction)),
  };
}

export async function recordAuditEvent(input: {
  organizationId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payload?: Record<string, unknown>;
}, database = getDatabase()) {
  await database.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType,
    input.resourceId, JSON.stringify(input.payload ?? {}), new Date().toISOString(),
  ).run();
}
