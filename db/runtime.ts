import { env } from 'cloudflare:workers';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export type DashboardTransaction = {
  id: string; counterparty: string; description: string; amount: number; currency: string;
  status: string; riskScore: number; createdAt: string;
};

export type DashboardData = {
  organizationId: string; organizationName: string; environment: string; balance: number;
  processedThisMonth: number; approvalRate: number; activeAccounts: number; riskAlerts: number;
  transactions: DashboardTransaction[];
};

let schemaReady: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable');
  return env.DB;
}

export function getFilesBucket(): R2Bucket {
  if (!env.FILES) throw new Error('R2 binding FILES is unavailable');
  return env.FILES;
}

export function ensureDatabase(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

async function createSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL DEFAULT 'AR', status TEXT NOT NULL DEFAULT 'sandbox', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, external_user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      type TEXT NOT NULL, counterparty TEXT NOT NULL, description TEXT NOT NULL,
      amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'ARS', status TEXT NOT NULL DEFAULT 'pending',
      risk_score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(organization_id, idempotency_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL, email TEXT NOT NULL,
      volume TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
      country TEXT NOT NULL, tax_id_last4 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, customer_id TEXT NOT NULL, currency TEXT NOT NULL,
      country TEXT NOT NULL, account_reference TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, account_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      product TEXT NOT NULL, format TEXT NOT NULL, last4 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS compliance_documents (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, object_key TEXT NOT NULL,
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'received', uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_members_organization ON members(organization_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_transactions_org_created ON transactions(organization_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_transactions_org_status ON transactions(organization_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_customers_org_created ON customers(organization_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_accounts_org_created ON accounts(organization_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_accounts_customer ON accounts(customer_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_org_created ON cards(organization_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_account ON cards(account_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_compliance_org_created ON compliance_documents(organization_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_events(organization_id, created_at)'),
  ]);
  await db.prepare('PRAGMA optimize').run();
}

export async function getOrCreateOrganization(user: ChatGPTUser) {
  await ensureDatabase();
  const db = getD1();
  const member = await db.prepare('SELECT organization_id AS organizationId FROM members WHERE external_user_id = ? LIMIT 1')
    .bind(user.userId).first<{ organizationId: string }>();
  if (member) return member.organizationId;
  const now = new Date().toISOString();
  const organizationId = crypto.randomUUID();
  const safeBase = user.email.split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'workspace';
  await db.batch([
    db.prepare('INSERT INTO organizations (id, name, slug, country, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(organizationId, 'Finanzas Moda', `${safeBase}-${organizationId.slice(0, 6)}`, 'AR', 'sandbox', now),
    db.prepare('INSERT INTO members (id, organization_id, external_user_id, email, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), organizationId, user.userId, user.email, 'owner', now),
  ]);
  await seedTransactions(organizationId);
  return organizationId;
}

async function seedTransactions(organizationId: string) {
  const db = getD1();
  const rows = [
    ['Pago QR · Mercado Uno', 'Cobro QR interoperable', 82450, 'ARS', 'settled', 4],
    ['Transferencia CVU', 'Ingreso desde cuenta bancaria', 210000, 'ARS', 'settled', 8],
    ['Cloud Services', 'Tarjeta corporativa terminada en 4821', -480, 'USD', 'authorized', 12],
    ['Distribuidora Andina', 'Pago a proveedor', -128500, 'ARS', 'settled', 18],
    ['Marketplace Centro', 'Liquidación split', 315900, 'ARS', 'review', 72],
  ] as const;
  const now = Date.now();
  await db.batch(rows.map((row, index) => db.prepare(
    `INSERT OR IGNORE INTO transactions
      (id, organization_id, idempotency_key, type, counterparty, description, amount, currency, status, risk_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), organizationId, `seed-${index}`, row[2] >= 0 ? 'credit' : 'debit', row[0], row[1], row[2], row[3], row[4], row[5], new Date(now - index * 2_700_000).toISOString())));
}

export async function getDashboardData(user: ChatGPTUser): Promise<DashboardData> {
  const organizationId = await getOrCreateOrganization(user);
  const db = getD1();
  const organization = await db.prepare('SELECT name, status FROM organizations WHERE id = ? LIMIT 1')
    .bind(organizationId).first<{ name: string; status: string }>();
  const transactionResult = await db.prepare(
    `SELECT id, counterparty, description, amount, currency, status, risk_score AS riskScore, created_at AS createdAt
     FROM transactions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 8`,
  ).bind(organizationId).all<DashboardTransaction>();
  const summary = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('settled','authorized') THEN amount ELSE 0 END), 0) AS balance,
      COALESCE(SUM(ABS(amount)), 0) AS processed,
      COALESCE(AVG(CASE WHEN status IN ('settled','authorized') THEN 100.0 ELSE 0 END), 0) AS approval,
      SUM(CASE WHEN risk_score >= 60 OR status = 'review' THEN 1 ELSE 0 END) AS alerts
     FROM transactions WHERE organization_id = ?`,
  ).bind(organizationId).first<{ balance: number; processed: number; approval: number; alerts: number }>();
  return {
    organizationId, organizationName: organization?.name ?? 'Mi organización', environment: organization?.status ?? 'sandbox',
    balance: Number(summary?.balance ?? 0), processedThisMonth: Number(summary?.processed ?? 0),
    approvalRate: Number(summary?.approval ?? 0), activeAccounts: 2481, riskAlerts: Number(summary?.alerts ?? 0),
    transactions: transactionResult.results ?? [],
  };
}

export async function recordAuditEvent(input: {
  organizationId: string; actorId: string; action: string; resourceType: string;
  resourceId: string; payload?: Record<string, unknown>;
}) {
  await getD1().prepare(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.organizationId, input.actorId, input.action, input.resourceType,
    input.resourceId, JSON.stringify(input.payload ?? {}), new Date().toISOString()).run();
}
