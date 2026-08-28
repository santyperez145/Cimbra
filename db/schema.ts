import { sql } from 'drizzle-orm';
import { type AnyPgColumn, bigint, check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(), name: text('name').notNull(), slug: text('slug').notNull(),
  country: text('country').notNull().default('AR'), status: text('status').notNull().default('sandbox'),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_organizations_slug').on(table.slug)]);

export const users = pgTable('users', {
  id: text('id').primaryKey(), username: text('username').notNull(), email: text('email').notNull(),
  displayName: text('display_name').notNull(), passwordHash: text('password_hash'), passwordSalt: text('password_salt'),
  passwordIterations: integer('password_iterations'), emailVerified: integer('email_verified').notNull().default(0),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_users_username').on(table.username), uniqueIndex('idx_users_email').on(table.email)]);

export const oauthIdentities = pgTable('oauth_identities', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), provider: text('provider').notNull(),
  providerSubject: text('provider_subject').notNull(), providerEmail: text('provider_email'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_oauth_provider_subject').on(table.provider, table.providerSubject),
  index('idx_oauth_user').on(table.userId),
]);

export const authSessions = pgTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(), lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [index('idx_auth_sessions_user').on(table.userId), index('idx_auth_sessions_expires').on(table.expiresAt)]);

export const oauthStates = pgTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(), provider: text('provider').notNull(), codeVerifier: text('code_verifier').notNull(),
  nonce: text('nonce').notNull(), returnTo: text('return_to').notNull(), expiresAt: text('expires_at').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_oauth_states_expires').on(table.expiresAt)]);

export const authAttempts = pgTable('auth_attempts', {
  id: text('id').primaryKey(), action: text('action').notNull(), identityHash: text('identity_hash').notNull(),
  ipHash: text('ip_hash').notNull(), success: integer('success').notNull().default(0), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_auth_attempts_identity').on(table.action, table.identityHash, table.createdAt),
  index('idx_auth_attempts_ip').on(table.action, table.ipHash, table.createdAt),
]);

export const members = pgTable('members', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('external_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), email: text('email').notNull(),
  role: text('role').notNull().default('owner'), createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_members_user').on(table.userId), index('idx_members_organization').on(table.organizationId)]);

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), type: text('type').notNull(),
  counterparty: text('counterparty').notNull(), description: text('description').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull().default('ARS'),
  status: text('status').notNull().default('pending'), riskScore: integer('risk_score').notNull().default(0),
  reversalOf: text('reversal_of').references((): AnyPgColumn => transactions.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_transactions_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_transactions_org_created').on(table.organizationId, table.createdAt),
  index('idx_transactions_org_status').on(table.organizationId, table.status),
  uniqueIndex('idx_transactions_reversal').on(table.reversalOf),
  check('transactions_amount_nonzero', sql`${table.amountMinor} <> 0`),
  check('transactions_risk_range', sql`${table.riskScore} BETWEEN 0 AND 100`),
]);

export const leads = pgTable('leads', {
  id: text('id').primaryKey(), name: text('name').notNull(), company: text('company').notNull(),
  email: text('email').notNull(), volume: text('volume').notNull(), message: text('message').notNull().default(''),
  status: text('status').notNull().default('new'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_leads_created').on(table.createdAt)]);

export const customers = pgTable('customers', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }), type: text('type').notNull(),
  name: text('name').notNull(), country: text('country').notNull(), taxIdLast4: text('tax_id_last4').notNull(),
  status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_customers_org_created').on(table.organizationId, table.createdAt)]);

export const financialAccounts = pgTable('financial_accounts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(), name: text('name').notNull(),
  currency: text('currency').notNull(), accountClass: text('account_class').notNull(),
  normalBalance: text('normal_balance').notNull(), status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_financial_accounts_org_purpose_currency').on(table.organizationId, table.purpose, table.currency),
  index('idx_financial_accounts_org').on(table.organizationId),
  check('financial_accounts_class', sql`${table.accountClass} IN ('asset', 'liability', 'equity', 'revenue', 'expense')`),
  check('financial_accounts_normal_balance', sql`${table.normalBalance} IN ('debit', 'credit')`),
]);

export const ledgerJournals = pgTable('ledger_journals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), kind: text('kind').notNull(),
  description: text('description').notNull(), currency: text('currency').notNull(),
  status: text('status').notNull().default('posted'),
  reversalOf: text('reversal_of').references((): AnyPgColumn => ledgerJournals.id, { onDelete: 'restrict' }),
  postedAt: text('posted_at'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_ledger_journals_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_ledger_journals_transaction').on(table.transactionId),
  index('idx_ledger_journals_org_created').on(table.organizationId, table.createdAt),
  index('idx_ledger_journals_reversal').on(table.reversalOf),
  check('ledger_journals_status', sql`${table.status} IN ('posted', 'reversed')`),
]);

export const ledgerPostings = pgTable('ledger_postings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  journalId: text('journal_id').notNull().references(() => ledgerJournals.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
  direction: text('direction').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_ledger_postings_journal').on(table.journalId),
  index('idx_ledger_postings_account_created').on(table.accountId, table.createdAt),
  check('ledger_postings_direction', sql`${table.direction} IN ('debit', 'credit')`),
  check('ledger_postings_amount_positive', sql`${table.amountMinor} > 0`),
]);

export const holds = pgTable('holds', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_holds_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_holds_account_status').on(table.accountId, table.status),
  check('holds_amount_positive', sql`${table.amountMinor} > 0`),
  check('holds_status', sql`${table.status} IN ('active', 'captured', 'released', 'expired')`),
]);

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  ledgerAccountId: text('ledger_account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
  currency: text('currency').notNull(), country: text('country').notNull(), accountReference: text('account_reference').notNull(),
  status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_accounts_org_created').on(table.organizationId, table.createdAt),
  index('idx_accounts_customer').on(table.customerId),
  uniqueIndex('idx_accounts_ledger_account').on(table.ledgerAccountId),
]);

export const cards = pgTable('cards', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }), product: text('product').notNull(), format: text('format').notNull(),
  last4: text('last4').notNull(), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_cards_org_created').on(table.organizationId, table.createdAt), index('idx_cards_account').on(table.accountId)]);

export const complianceDocuments = pgTable('compliance_documents', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(), fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(), size: integer('size').notNull(),
  status: text('status').notNull().default('received'), uploadedBy: text('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_compliance_org_created').on(table.organizationId, table.createdAt)]);

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(), resourceType: text('resource_type').notNull(), resourceId: text('resource_id').notNull(),
  payload: text('payload').notNull().default('{}'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_audit_org_created').on(table.organizationId, table.createdAt)]);
