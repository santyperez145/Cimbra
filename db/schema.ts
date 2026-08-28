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
  mfaEnabled: integer('mfa_enabled').notNull().default(0), mfaSecretCiphertext: text('mfa_secret_ciphertext'),
  mfaLastUsedStep: bigint('mfa_last_used_step', { mode: 'bigint' }),
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

export const authActionTokens = pgTable('auth_action_tokens', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), tokenHash: text('token_hash').notNull(), expiresAt: text('expires_at').notNull(),
  consumedAt: text('consumed_at'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_auth_action_tokens_hash').on(table.tokenHash),
  index('idx_auth_action_tokens_user_type').on(table.userId, table.type, table.createdAt),
  index('idx_auth_action_tokens_expires').on(table.expiresAt),
  check('auth_action_tokens_type', sql`${table.type} IN ('email_verification', 'password_reset', 'mfa_challenge')`),
]);

export const mfaRecoveryCodes = pgTable('mfa_recovery_codes', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(), consumedAt: text('consumed_at'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_mfa_recovery_codes_hash').on(table.codeHash),
  index('idx_mfa_recovery_codes_user').on(table.userId, table.consumedAt),
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
  idempotencyKey: text('idempotency_key'),
  name: text('name').notNull(), country: text('country').notNull(), taxIdLast4: text('tax_id_last4').notNull(),
  status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_customers_org_created').on(table.organizationId, table.createdAt),
  uniqueIndex('idx_customers_org_idempotency').on(table.organizationId, table.idempotencyKey),
]);

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
  idempotencyKey: text('idempotency_key'),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  ledgerAccountId: text('ledger_account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
  currency: text('currency').notNull(), country: text('country').notNull(), accountReference: text('account_reference').notNull(),
  status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_accounts_org_created').on(table.organizationId, table.createdAt),
  index('idx_accounts_customer').on(table.customerId),
  uniqueIndex('idx_accounts_ledger_account').on(table.ledgerAccountId),
  uniqueIndex('idx_accounts_org_idempotency').on(table.organizationId, table.idempotencyKey),
]);

export const cards = pgTable('cards', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key'),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }), product: text('product').notNull(), format: text('format').notNull(),
  last4: text('last4').notNull(), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_cards_org_created').on(table.organizationId, table.createdAt), index('idx_cards_account').on(table.accountId),
  uniqueIndex('idx_cards_org_idempotency').on(table.organizationId, table.idempotencyKey),
]);

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

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), prefix: text('prefix').notNull(), secretHash: text('secret_hash').notNull(),
  scopes: text('scopes').notNull().default('[]'), status: text('status').notNull().default('active'),
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(300),
  rateWindowStartedAt: text('rate_window_started_at'), rateWindowCount: integer('rate_window_count').notNull().default(0),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  lastUsedAt: text('last_used_at'), expiresAt: text('expires_at'), revokedAt: text('revoked_at'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_api_keys_prefix').on(table.prefix),
  index('idx_api_keys_org_created').on(table.organizationId, table.createdAt),
  check('api_keys_status', sql`${table.status} IN ('active', 'revoked')`),
  check('api_keys_rate_limit_positive', sql`${table.rateLimitPerMinute} > 0 AND ${table.rateWindowCount} >= 0`),
]);

export const riskRules = pgTable('risk_rules', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  name: text('name').notNull(), kind: text('kind').notNull(), operationType: text('operation_type').notNull().default('any'),
  scoreDelta: integer('score_delta').notNull(), action: text('action').notNull(), configuration: text('configuration').notNull().default('{}'),
  priority: integer('priority').notNull().default(100), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_rules_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_rules_org_status_priority').on(table.organizationId, table.status, table.priority),
  check('risk_rules_kind', sql`${table.kind} IN ('amount_threshold', 'velocity_count', 'counterparty_match')`),
  check('risk_rules_operation', sql`${table.operationType} IN ('any', 'transfer', 'cash_in', 'cash_out')`),
  check('risk_rules_score', sql`${table.scoreDelta} BETWEEN 0 AND 100`),
  check('risk_rules_action', sql`${table.action} IN ('score', 'review', 'decline')`),
  check('risk_rules_priority', sql`${table.priority} BETWEEN 1 AND 1000`),
  check('risk_rules_status', sql`${table.status} IN ('active', 'disabled')`),
]);

export const riskEvaluations = pgTable('risk_evaluations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  operationType: text('operation_type').notNull(), resourceType: text('resource_type').notNull().default('transaction'), resourceId: text('resource_id'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(), counterparty: text('counterparty').notNull(),
  score: integer('score').notNull(), decision: text('decision').notNull(), matchedRuleIds: text('matched_rule_ids').notNull().default('[]'),
  reasons: text('reasons').notNull().default('[]'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_evaluations_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_evaluations_org_created').on(table.organizationId, table.createdAt),
  index('idx_risk_evaluations_resource').on(table.organizationId, table.resourceId),
  check('risk_evaluations_operation', sql`${table.operationType} IN ('transfer', 'cash_in', 'cash_out')`),
  check('risk_evaluations_score', sql`${table.score} BETWEEN 0 AND 100`),
  check('risk_evaluations_decision', sql`${table.decision} IN ('approve', 'review', 'decline')`),
]);

export const riskCases = pgTable('risk_cases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  evaluationId: text('evaluation_id').notNull().references(() => riskEvaluations.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  holdId: text('hold_id').references(() => holds.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('open'), priority: text('priority').notNull().default('medium'),
  resolution: text('resolution'), resolutionNote: text('resolution_note'), resolutionIdempotencyKey: text('resolution_idempotency_key'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }), resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_cases_evaluation').on(table.evaluationId),
  uniqueIndex('idx_risk_cases_org_resolution_idempotency').on(table.organizationId, table.resolutionIdempotencyKey),
  index('idx_risk_cases_org_status_created').on(table.organizationId, table.status, table.createdAt),
  check('risk_cases_status', sql`${table.status} IN ('open', 'resolved')`),
  check('risk_cases_priority', sql`${table.priority} IN ('low', 'medium', 'high', 'critical')`),
  check('risk_cases_resolution', sql`${table.resolution} IS NULL OR ${table.resolution} IN ('approved', 'declined')`),
]);

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  name: text('name').notNull(), source: text('source').notNull(), currency: text('currency').notNull(),
  periodStart: text('period_start').notNull(), periodEnd: text('period_end').notNull(), status: text('status').notNull().default('open'),
  expectedMinor: bigint('expected_minor', { mode: 'bigint' }).notNull().default(sql`0`), actualMinor: bigint('actual_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  differenceMinor: bigint('difference_minor', { mode: 'bigint' }).notNull().default(sql`0`), matchedCount: integer('matched_count').notNull().default(0),
  exceptionCount: integer('exception_count').notNull().default(0), createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_reconciliation_runs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_reconciliation_runs_org_created').on(table.organizationId, table.createdAt),
  check('reconciliation_runs_source', sql`${table.source} IN ('bank', 'clearing', 'card_network', 'cash_network', 'internal')`),
  check('reconciliation_runs_status', sql`${table.status} IN ('open', 'completed')`),
  check('reconciliation_runs_counts', sql`${table.matchedCount} >= 0 AND ${table.exceptionCount} >= 0`),
]);

export const reconciliationItems = pgTable('reconciliation_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }), externalReference: text('external_reference').notNull(),
  expectedMinor: bigint('expected_minor', { mode: 'bigint' }).notNull(), actualMinor: bigint('actual_minor', { mode: 'bigint' }).notNull(),
  differenceMinor: bigint('difference_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(), status: text('status').notNull(),
  reason: text('reason'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_reconciliation_items_run').on(table.runId, table.createdAt),
  uniqueIndex('idx_reconciliation_items_run_external').on(table.runId, table.externalReference),
  check('reconciliation_items_status', sql`${table.status} IN ('matched', 'mismatch', 'missing_internal', 'missing_external', 'resolved')`),
]);

export const reconciliationExceptions = pgTable('reconciliation_exceptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => reconciliationItems.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), differenceMinor: bigint('difference_minor', { mode: 'bigint' }).notNull(), status: text('status').notNull().default('open'),
  resolution: text('resolution'), resolutionNote: text('resolution_note'), resolutionIdempotencyKey: text('resolution_idempotency_key'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }), resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_reconciliation_exceptions_item').on(table.itemId),
  uniqueIndex('idx_reconciliation_exceptions_org_resolution_idempotency').on(table.organizationId, table.resolutionIdempotencyKey),
  index('idx_reconciliation_exceptions_org_status_created').on(table.organizationId, table.status, table.createdAt),
  check('reconciliation_exceptions_kind', sql`${table.kind} IN ('amount_mismatch', 'missing_internal', 'missing_external')`),
  check('reconciliation_exceptions_status', sql`${table.status} IN ('open', 'resolved', 'accepted')`),
  check('reconciliation_exceptions_resolution', sql`${table.resolution} IS NULL OR ${table.resolution} IN ('corrected', 'accepted')`),
]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), url: text('url').notNull(), eventTypes: text('event_types').notNull().default('[]'),
  secretCiphertext: text('secret_ciphertext').notNull(), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  secretRotatedAt: text('secret_rotated_at').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_webhook_endpoints_org_url').on(table.organizationId, table.url),
  index('idx_webhook_endpoints_org_created').on(table.organizationId, table.createdAt),
  check('webhook_endpoints_status', sql`${table.status} IN ('active', 'disabled')`),
]);

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), resourceType: text('resource_type').notNull(), resourceId: text('resource_id').notNull(),
  payload: text('payload').notNull(), status: text('status').notNull().default('pending'), createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_webhook_events_org_created').on(table.organizationId, table.createdAt),
  check('webhook_events_status', sql`${table.status} IN ('pending', 'delivered', 'partial', 'exhausted', 'skipped')`),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull().references(() => webhookEvents.id, { onDelete: 'cascade' }),
  endpointId: text('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), attemptCount: integer('attempt_count').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0), nextAttemptAt: text('next_attempt_at').notNull(), lockedUntil: text('locked_until'),
  responseStatus: integer('response_status'), responseExcerpt: text('response_excerpt'), lastError: text('last_error'),
  deliveredAt: text('delivered_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_webhook_deliveries_event_endpoint').on(table.eventId, table.endpointId),
  index('idx_webhook_deliveries_due').on(table.status, table.nextAttemptAt, table.lockedUntil),
  index('idx_webhook_deliveries_org_created').on(table.organizationId, table.createdAt),
  check('webhook_deliveries_status', sql`${table.status} IN ('pending', 'processing', 'retry', 'delivered', 'exhausted', 'cancelled')`),
  check('webhook_deliveries_attempts_nonnegative', sql`${table.attemptCount} >= 0 AND ${table.retryCount} >= 0`),
]);

export const webhookDeliveryAttempts = pgTable('webhook_delivery_attempts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  deliveryId: text('delivery_id').notNull().references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(), status: text('status').notNull(), responseStatus: integer('response_status'),
  responseExcerpt: text('response_excerpt'), error: text('error'), startedAt: text('started_at').notNull(), completedAt: text('completed_at').notNull(),
}, (table) => [
  uniqueIndex('idx_webhook_attempt_delivery_number').on(table.deliveryId, table.attemptNumber),
  index('idx_webhook_attempts_org_started').on(table.organizationId, table.startedAt),
  check('webhook_attempts_status', sql`${table.status} IN ('delivered', 'failed')`),
]);
