import type { AuthUser } from '@/app/lib/auth/types';
import type { Currency } from '@/app/lib/ledger/money';
import { minorToMajorNumber } from '@/app/lib/ledger/money';
import type { OrganizationRole } from '@/app/lib/platform/access-policy';
import type { CardFormat, CardProduct, CardStatus } from '@/app/lib/platform/card-issuing';
import { getDatabaseClient } from './client';
import { getLedgerBalances, listActiveHolds, seedOrganizationLedger, serializeTransaction, type ActiveHold, type LedgerBalance } from './ledger';
import { enqueueWebhookEvent } from './platform';
import { ensureOrganizationMembership } from './access';

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
  role: OrganizationRole;
  balance: number;
  processedThisMonth: number;
  approvalRate: number;
  transactionCount: number;
  activeAccounts: number;
  riskAlerts: number;
  journalCount: number;
  cards: Array<{
    id: string;
    programId: string | null;
    programName: string | null;
    accountId: string;
    customerId: string;
    product: CardProduct;
    format: CardFormat;
    last4: string;
    status: CardStatus;
    statusReason: string | null;
    activatedAt: string | null;
    terminatedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  accounts: Array<{
    id: string; customerId: string; currency: Currency; country: string; accountReference: string;
    balance: number; balanceMinor: string; status: string; createdAt: string;
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

export type { OrganizationRole } from '@/app/lib/platform/access-policy';

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
  const member = await ensureOrganizationMembership(user);
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
  const { organizationId, role } = await getOrganizationContext(user);
  const database = getDatabase();
  const organization = await database.prepare('SELECT name, status FROM organizations WHERE id = ? LIMIT 1')
    .bind(organizationId).first<{ name: string; status: string }>();
  const transactionRows = await database.prepare(
    `SELECT id, counterparty, description, amount_minor::text AS amountMinor, currency, status,
      risk_score AS riskScore, reversal_of AS reversalOf, created_at AS createdAt
     FROM transactions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
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
  const [balances, holds, accountRows, cardRows, documentRows, journalSummary] = await Promise.all([
    getLedgerBalances(organizationId),
    listActiveHolds(organizationId),
    database.prepare(
      `SELECT a.id, a.customer_id AS "customerId", a.currency, a.country, a.account_reference AS "accountReference",
        COALESCE(SUM(CASE WHEN p.direction = f.normal_balance THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS "balanceMinor",
        a.status, a.created_at AS "createdAt"
       FROM accounts a JOIN financial_accounts f ON f.id = a.ledger_account_id
       LEFT JOIN ledger_postings p ON p.account_id = f.id
       WHERE a.organization_id = ? GROUP BY a.id, f.normal_balance ORDER BY a.created_at DESC LIMIT 100`,
    ).bind(organizationId).all<{
      id: string; customerId: string; currency: Currency; country: string; accountReference: string;
      balanceMinor: string; status: string; createdAt: string;
    }>(),
    database.prepare(
      `SELECT c.id, c.program_id AS "programId", p.name AS "programName", c.account_id AS "accountId",
        c.customer_id AS "customerId", c.product, c.format, c.last4, c.status, c.status_reason AS "statusReason",
        c.activated_at AS "activatedAt", c.terminated_at AS "terminatedAt", c.created_at AS "createdAt",
        COALESCE(c.updated_at, c.created_at) AS "updatedAt"
       FROM cards c LEFT JOIN card_programs p ON p.id = c.program_id
       WHERE c.organization_id = ? ORDER BY c.created_at DESC LIMIT 100`,
    ).bind(organizationId).all<{
      id: string; programId: string | null; programName: string | null; accountId: string; customerId: string;
      product: CardProduct; format: CardFormat; last4: string; status: CardStatus; statusReason: string | null;
      activatedAt: string | null; terminatedAt: string | null; createdAt: string; updatedAt: string;
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
    role,
    balance: primaryBalance?.available ?? 0,
    processedThisMonth: minorToMajorNumber(summary?.processedMinor ?? '0', 'ARS'),
    approvalRate: Number(summary?.approval ?? 0),
    transactionCount: Number(summary?.transactionCount ?? 0),
    activeAccounts: Number(accountCount?.count ?? 0),
    riskAlerts: holds.length,
    journalCount: Number(journalSummary?.count ?? 0),
    cards: cardRows.results,
    accounts: accountRows.results.map((account) => ({ ...account, balance: minorToMajorNumber(account.balanceMinor, account.currency) })),
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
  return enqueueWebhookEvent(database, {
    organizationId: input.organizationId,
    eventType: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    data: input.payload,
  });
}
