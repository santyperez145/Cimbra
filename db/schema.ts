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
}, (table) => [
  uniqueIndex('idx_members_user').on(table.userId), index('idx_members_organization').on(table.organizationId),
  check('members_role', sql`${table.role} IN ('owner', 'admin', 'operator', 'viewer')`),
]);

export const organizationInvitations = pgTable('organization_invitations', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), role: text('role').notNull(), status: text('status').notNull().default('pending'),
  invitedBy: text('invited_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }), expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_organization_invitations_org_email').on(table.organizationId, table.email),
  index('idx_organization_invitations_email_status').on(table.email, table.status, table.expiresAt),
  check('organization_invitations_role', sql`${table.role} IN ('admin', 'operator', 'viewer')`),
  check('organization_invitations_status', sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`),
]);

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

export const bookTransfers = pgTable('book_transfers', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  externalReference: text('external_reference').notNull(),
  sourceAccountId: text('source_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  destinationAccountId: text('destination_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'restrict' }),
  reversalTransactionId: text('reversal_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  description: text('description').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), status: text('status').notNull().default('settled'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reversedAt: text('reversed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_book_transfers_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_book_transfers_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_book_transfers_transaction').on(table.transactionId),
  uniqueIndex('idx_book_transfers_reversal').on(table.reversalTransactionId),
  index('idx_book_transfers_org_created').on(table.organizationId, table.createdAt),
  index('idx_book_transfers_source_created').on(table.sourceAccountId, table.createdAt),
  index('idx_book_transfers_destination_created').on(table.destinationAccountId, table.createdAt),
  check('book_transfers_distinct_accounts', sql`${table.sourceAccountId} <> ${table.destinationAccountId}`),
  check('book_transfers_amount_positive', sql`${table.amountMinor} > 0`),
  check('book_transfers_status', sql`${table.status} IN ('review', 'settled', 'reversed', 'cancelled')`),
  check('book_transfers_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
]);

export const payoutBeneficiaries = pgTable('payout_beneficiaries', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  externalReference: text('external_reference').notNull(), name: text('name').notNull(), entityType: text('entity_type').notNull(),
  country: text('country').notNull(), currency: text('currency').notNull(), destinationType: text('destination_type').notNull(),
  destinationHash: text('destination_hash').notNull(), destinationLast4: text('destination_last4').notNull(), bankCode: text('bank_code'),
  status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payout_beneficiaries_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_payout_beneficiaries_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_payout_beneficiaries_org_destination').on(table.organizationId, table.destinationHash),
  index('idx_payout_beneficiaries_org_status').on(table.organizationId, table.status, table.createdAt),
  check('payout_beneficiaries_entity_type', sql`${table.entityType} IN ('individual', 'business')`),
  check('payout_beneficiaries_destination_type', sql`${table.destinationType} IN ('local_account', 'alias', 'iban', 'clabe', 'pix_key')`),
  check('payout_beneficiaries_status', sql`${table.status} IN ('active', 'suspended')`),
  check('payout_beneficiaries_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
]);

export const payoutBatches = pgTable('payout_batches', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sourceAccountId: text('source_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  externalReference: text('external_reference').notNull(), description: text('description').notNull(), currency: text('currency').notNull(),
  status: text('status').notNull().default('draft'), totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' }).notNull(),
  itemCount: integer('item_count').notNull(), scheduledFor: text('scheduled_for'), processBefore: text('process_before'),
  processingLeaseUntil: text('processing_lease_until'), submittedAt: text('submitted_at'), startedAt: text('started_at'),
  completedAt: text('completed_at'), cancelledAt: text('cancelled_at'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payout_batches_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_payout_batches_org_reference').on(table.organizationId, table.externalReference),
  index('idx_payout_batches_org_status_schedule').on(table.organizationId, table.status, table.scheduledFor),
  check('payout_batches_status', sql`${table.status} IN ('draft', 'pending_approval', 'scheduled', 'processing', 'requires_attention', 'completed', 'partially_failed', 'failed', 'cancelled')`),
  check('payout_batches_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('payout_batches_total_positive', sql`${table.totalAmountMinor} > 0`),
  check('payout_batches_item_count', sql`${table.itemCount} BETWEEN 1 AND 100`),
]);

export const payoutItems = pgTable('payout_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').notNull().references(() => payoutBatches.id, { onDelete: 'cascade' }),
  beneficiaryId: text('beneficiary_id').notNull().references(() => payoutBeneficiaries.id, { onDelete: 'restrict' }),
  externalReference: text('external_reference').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), description: text('description').notNull(), status: text('status').notNull().default('pending'),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  failureCode: text('failure_code'), failureMessage: text('failure_message'), attemptCount: integer('attempt_count').notNull().default(0),
  processedAt: text('processed_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payout_items_batch_reference').on(table.batchId, table.externalReference),
  uniqueIndex('idx_payout_items_transaction').on(table.transactionId),
  index('idx_payout_items_batch_status').on(table.batchId, table.status, table.createdAt),
  index('idx_payout_items_org_created').on(table.organizationId, table.createdAt),
  check('payout_items_status', sql`${table.status} IN ('pending', 'processing', 'review', 'settled', 'failed', 'cancelled')`),
  check('payout_items_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('payout_items_amount_positive', sql`${table.amountMinor} > 0`),
  check('payout_items_attempts', sql`${table.attemptCount} BETWEEN 0 AND 3`),
]);

export const cardPrograms = pgTable('card_programs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  name: text('name').notNull(), product: text('product').notNull(), formats: text('formats').notNull(),
  defaultCurrency: text('default_currency').notNull(), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_card_programs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_card_programs_org_name').on(table.organizationId, table.name),
  index('idx_card_programs_org_created').on(table.organizationId, table.createdAt),
  check('card_programs_product', sql`${table.product} IN ('debit', 'credit', 'prepaid')`),
  check('card_programs_status', sql`${table.status} IN ('active', 'inactive')`),
  check('card_programs_currency', sql`${table.defaultCurrency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
]);

export const cards = pgTable('cards', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key'),
  programId: text('program_id').references(() => cardPrograms.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }), product: text('product').notNull(), format: text('format').notNull(),
  last4: text('last4').notNull(), status: text('status').notNull().default('active'), statusReason: text('status_reason'),
  activatedAt: text('activated_at'), terminatedAt: text('terminated_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at'),
}, (table) => [
  index('idx_cards_org_created').on(table.organizationId, table.createdAt), index('idx_cards_account').on(table.accountId), index('idx_cards_program').on(table.programId),
  uniqueIndex('idx_cards_org_idempotency').on(table.organizationId, table.idempotencyKey),
  check('cards_status', sql`${table.status} IN ('created', 'active', 'frozen', 'terminated')`),
  check('cards_format', sql`${table.format} IN ('virtual', 'physical')`),
  check('cards_product', sql`${table.product} IN ('debit', 'credit', 'prepaid')`),
]);

export const cardLifecycleEvents = pgTable('card_lifecycle_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  fromStatus: text('from_status'), toStatus: text('to_status').notNull(), reason: text('reason').notNull(),
  actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_card_lifecycle_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_card_lifecycle_card_created').on(table.cardId, table.createdAt),
  check('card_lifecycle_from_status', sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('created', 'active', 'frozen', 'terminated')`),
  check('card_lifecycle_to_status', sql`${table.toStatus} IN ('created', 'active', 'frozen', 'terminated')`),
]);

export const cardControls = pgTable('card_controls', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(), version: integer('version').notNull(),
  currency: text('currency').notNull(), perTransactionLimitMinor: bigint('per_transaction_limit_minor', { mode: 'bigint' }),
  dailyLimitMinor: bigint('daily_limit_minor', { mode: 'bigint' }), monthlyLimitMinor: bigint('monthly_limit_minor', { mode: 'bigint' }),
  allowedChannels: text('allowed_channels').notNull(), allowedMccs: text('allowed_mccs').notNull().default('[]'),
  blockedMccs: text('blocked_mccs').notNull().default('[]'), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_card_controls_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_card_controls_card_version').on(table.cardId, table.version),
  index('idx_card_controls_org_created').on(table.organizationId, table.createdAt),
  check('card_controls_version', sql`${table.version} > 0`),
  check('card_controls_status', sql`${table.status} IN ('active', 'inactive')`),
  check('card_controls_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('card_controls_limits_positive', sql`(${table.perTransactionLimitMinor} IS NULL OR ${table.perTransactionLimitMinor} > 0) AND (${table.dailyLimitMinor} IS NULL OR ${table.dailyLimitMinor} > 0) AND (${table.monthlyLimitMinor} IS NULL OR ${table.monthlyLimitMinor} > 0)`),
]);

export const complianceDocuments = pgTable('compliance_documents', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(), fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(), size: integer('size').notNull(),
  status: text('status').notNull().default('received'), uploadedBy: text('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_compliance_org_created').on(table.organizationId, table.createdAt)]);

export const dueDiligenceCases = pgTable('due_diligence_cases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  kind: text('kind').notNull(), jurisdiction: text('jurisdiction').notNull(), policyVersion: text('policy_version').notNull(),
  requiredChecks: text('required_checks').notNull(), status: text('status').notNull().default('draft'),
  riskRating: text('risk_rating').notNull().default('unassessed'), expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  submittedBy: text('submitted_by').references(() => users.id, { onDelete: 'restrict' }), submittedAt: text('submitted_at'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }), resolutionNote: text('resolution_note'),
  resolvedAt: text('resolved_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_due_diligence_cases_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_due_diligence_cases_customer_active').on(table.organizationId, table.customerId)
    .where(sql`${table.status} IN ('draft', 'in_review')`),
  index('idx_due_diligence_cases_org_status_created').on(table.organizationId, table.status, table.createdAt),
  check('due_diligence_cases_kind', sql`${table.kind} IN ('kyc', 'kyb')`),
  check('due_diligence_cases_status', sql`${table.status} IN ('draft', 'in_review', 'approved', 'rejected', 'cancelled', 'expired')`),
  check('due_diligence_cases_risk', sql`${table.riskRating} IN ('unassessed', 'low', 'medium', 'high', 'prohibited')`),
]);

export const dueDiligenceParties = pgTable('due_diligence_parties', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => dueDiligenceCases.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  role: text('role').notNull(), name: text('name').notNull(), taxIdLast4: text('tax_id_last4').notNull(),
  ownershipBps: integer('ownership_bps'), pepDeclared: integer('pep_declared').notNull().default(0),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_due_diligence_parties_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_due_diligence_parties_case_created').on(table.caseId, table.createdAt),
  check('due_diligence_parties_role', sql`${table.role} IN ('subject', 'legal_representative', 'beneficial_owner', 'director')`),
  check('due_diligence_parties_tax_last4', sql`length(${table.taxIdLast4}) = 4`),
  check('due_diligence_parties_ownership', sql`${table.ownershipBps} IS NULL OR ${table.ownershipBps} BETWEEN 1 AND 10000`),
  check('due_diligence_parties_pep', sql`${table.pepDeclared} IN (0, 1)`),
]);

export const dueDiligenceChecks = pgTable('due_diligence_checks', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => dueDiligenceCases.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  checkType: text('check_type').notNull(), source: text('source').notNull(), status: text('status').notNull(),
  resultCode: text('result_code').notNull(), note: text('note').notNull(),
  evidenceDocumentId: text('evidence_document_id').references(() => complianceDocuments.id, { onDelete: 'restrict' }),
  checkedBy: text('checked_by').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_due_diligence_checks_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_due_diligence_checks_case_type_created').on(table.caseId, table.checkType, table.createdAt),
  check('due_diligence_checks_type', sql`${table.checkType} IN ('identity_document', 'address', 'sanctions', 'pep', 'business_registry', 'beneficial_ownership')`),
  check('due_diligence_checks_source', sql`${table.source} IN ('manual_review', 'official_registry', 'internal_list')`),
  check('due_diligence_checks_status', sql`${table.status} IN ('pending', 'passed', 'failed', 'review')`),
]);

export const dueDiligenceEvents = pgTable('due_diligence_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  caseId: text('case_id').notNull().references(() => dueDiligenceCases.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  event: text('event').notNull(), fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
  payload: text('payload').notNull().default('{}'), actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_due_diligence_events_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_due_diligence_events_case_created').on(table.caseId, table.createdAt),
  check('due_diligence_events_event', sql`${table.event} IN ('created', 'submitted', 'approved', 'rejected', 'cancelled', 'expired')`),
]);

export const billers = pgTable('billers', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  code: text('code').notNull(), name: text('name').notNull(), country: text('country').notNull(),
  category: text('category').notNull(), serviceType: text('service_type').notNull(), currency: text('currency').notNull(),
  amountMode: text('amount_mode').notNull(), minAmountMinor: bigint('min_amount_minor', { mode: 'bigint' }),
  maxAmountMinor: bigint('max_amount_minor', { mode: 'bigint' }), status: text('status').notNull().default('active'),
  contractReference: text('contract_reference'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_billers_org_code').on(table.organizationId, table.code),
  uniqueIndex('idx_billers_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_billers_org_status_country').on(table.organizationId, table.status, table.country),
  check('billers_country', sql`length(${table.country}) = 2`),
  check('billers_category', sql`${table.category} IN ('utilities', 'telecom', 'tax', 'education', 'health', 'insurance', 'transport', 'entertainment', 'other')`),
  check('billers_service_type', sql`${table.serviceType} IN ('bill_payment', 'mobile_topup', 'gift_card')`),
  check('billers_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('billers_amount_mode', sql`${table.amountMode} IN ('exact', 'range', 'fixed')`),
  check('billers_amount_range', sql`(${table.minAmountMinor} IS NULL OR ${table.minAmountMinor} > 0) AND (${table.maxAmountMinor} IS NULL OR ${table.maxAmountMinor} > 0) AND (${table.minAmountMinor} IS NULL OR ${table.maxAmountMinor} IS NULL OR ${table.minAmountMinor} <= ${table.maxAmountMinor})`),
  check('billers_status', sql`${table.status} IN ('active', 'suspended')`),
]);

export const billerObligations = pgTable('biller_obligations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  billerId: text('biller_id').notNull().references(() => billers.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  externalReference: text('external_reference').notNull(), subscriberReferenceHash: text('subscriber_reference_hash').notNull(),
  subscriberReferenceLast4: text('subscriber_reference_last4').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), dueAt: text('due_at').notNull(), description: text('description').notNull(),
  status: text('status').notNull().default('open'), paidAt: text('paid_at'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_biller_obligations_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_biller_obligations_external').on(table.organizationId, table.billerId, table.externalReference),
  index('idx_biller_obligations_lookup').on(table.organizationId, table.billerId, table.subscriberReferenceHash, table.status, table.dueAt),
  check('biller_obligations_amount_positive', sql`${table.amountMinor} > 0`),
  check('biller_obligations_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('biller_obligations_status', sql`${table.status} IN ('open', 'paid', 'cancelled', 'expired')`),
  check('biller_obligations_reference_last4', sql`length(${table.subscriberReferenceLast4}) = 4`),
]);

export const recurringPaymentMandates = pgTable('recurring_payment_mandates', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  billerId: text('biller_id').notNull().references(() => billers.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  subscriberReferenceHash: text('subscriber_reference_hash').notNull(), subscriberReferenceLast4: text('subscriber_reference_last4').notNull(),
  frequency: text('frequency').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }),
  amountLimitMinor: bigint('amount_limit_minor', { mode: 'bigint' }).notNull(), consentReference: text('consent_reference').notNull(),
  consentedAt: text('consented_at').notNull(), status: text('status').notNull().default('active'),
  nextChargeAt: text('next_charge_at').notNull(), pendingScheduledFor: text('pending_scheduled_for'),
  lastExecutedAt: text('last_executed_at'), retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3), cancelledAt: text('cancelled_at'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_recurring_mandates_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_recurring_mandates_org_consent').on(table.organizationId, table.consentReference),
  index('idx_recurring_mandates_due').on(table.status, table.nextChargeAt),
  index('idx_recurring_mandates_org_account').on(table.organizationId, table.accountId, table.status),
  check('recurring_mandates_frequency', sql`${table.frequency} IN ('weekly', 'monthly')`),
  check('recurring_mandates_amounts', sql`${table.amountLimitMinor} > 0 AND (${table.amountMinor} IS NULL OR ${table.amountMinor} > 0) AND (${table.amountMinor} IS NULL OR ${table.amountMinor} <= ${table.amountLimitMinor})`),
  check('recurring_mandates_status', sql`${table.status} IN ('active', 'paused', 'cancelled', 'expired')`),
  check('recurring_mandates_reference_last4', sql`length(${table.subscriberReferenceLast4}) = 4`),
  check('recurring_mandates_retries', sql`${table.retryCount} >= 0 AND ${table.maxRetries} BETWEEN 0 AND 10`),
]);

export const billPaymentOrders = pgTable('bill_payment_orders', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  billerId: text('biller_id').notNull().references(() => billers.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  obligationId: text('obligation_id').references(() => billerObligations.id, { onDelete: 'restrict' }),
  mandateId: text('mandate_id').references(() => recurringPaymentMandates.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  reversalTransactionId: text('reversal_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  serviceType: text('service_type').notNull(), destinationReferenceHash: text('destination_reference_hash').notNull(),
  destinationReferenceLast4: text('destination_reference_last4').notNull(), amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(), status: text('status').notNull(), failureCode: text('failure_code'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), settledAt: text('settled_at'), reversedAt: text('reversed_at'),
}, (table) => [
  uniqueIndex('idx_bill_payment_orders_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_bill_payment_orders_transaction').on(table.transactionId),
  uniqueIndex('idx_bill_payment_orders_reversal').on(table.reversalTransactionId),
  uniqueIndex('idx_bill_payment_orders_active_obligation').on(table.obligationId)
    .where(sql`${table.obligationId} IS NOT NULL AND ${table.status} IN ('review', 'settled')`),
  index('idx_bill_payment_orders_org_status_created').on(table.organizationId, table.status, table.createdAt),
  index('idx_bill_payment_orders_obligation').on(table.obligationId),
  index('idx_bill_payment_orders_mandate').on(table.mandateId, table.createdAt),
  check('bill_payment_orders_service_type', sql`${table.serviceType} IN ('bill_payment', 'mobile_topup', 'gift_card')`),
  check('bill_payment_orders_amount_positive', sql`${table.amountMinor} > 0`),
  check('bill_payment_orders_currency', sql`${table.currency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
  check('bill_payment_orders_status', sql`${table.status} IN ('declined', 'review', 'settled', 'reversed', 'cancelled')`),
  check('bill_payment_orders_reference_last4', sql`length(${table.destinationReferenceLast4}) = 4`),
]);

export const recurringPaymentExecutions = pgTable('recurring_payment_executions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  mandateId: text('mandate_id').notNull().references(() => recurringPaymentMandates.id, { onDelete: 'restrict' }),
  orderId: text('order_id').references(() => billPaymentOrders.id, { onDelete: 'restrict' }),
  scheduledFor: text('scheduled_for').notNull(), attemptNumber: integer('attempt_number').notNull().default(1),
  status: text('status').notNull(), errorCode: text('error_code'),
  attemptedAt: text('attempted_at').notNull(),
}, (table) => [
  uniqueIndex('idx_recurring_executions_mandate_schedule_attempt').on(table.mandateId, table.scheduledFor, table.attemptNumber),
  index('idx_recurring_executions_org_attempted').on(table.organizationId, table.attemptedAt),
  check('recurring_executions_status', sql`${table.status} IN ('settled', 'review', 'declined', 'skipped_no_debt', 'failed')`),
  check('recurring_executions_attempt', sql`${table.attemptNumber} > 0`),
]);

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
  environment: text('environment').notNull().default('test'),
}, (table) => [
  uniqueIndex('idx_api_keys_prefix').on(table.prefix),
  index('idx_api_keys_org_created').on(table.organizationId, table.createdAt),
  check('api_keys_status', sql`${table.status} IN ('active', 'revoked')`),
  check('api_keys_environment', sql`${table.environment} IN ('test', 'live')`),
  check('api_keys_rate_limit_positive', sql`${table.rateLimitPerMinute} > 0 AND ${table.rateWindowCount} >= 0`),
]);

export const riskRules = pgTable('risk_rules', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  familyId: text('family_id').notNull(), version: integer('version').notNull().default(1),
  deployment: text('deployment').notNull().default('champion'),
  name: text('name').notNull(), kind: text('kind').notNull(), operationType: text('operation_type').notNull().default('any'),
  scoreDelta: integer('score_delta').notNull(), action: text('action').notNull(), configuration: text('configuration').notNull().default('{}'),
  priority: integer('priority').notNull().default(100), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_rules_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_risk_rules_org_family_version').on(table.organizationId, table.familyId, table.version),
  uniqueIndex('idx_risk_rules_one_active_champion').on(table.organizationId, table.familyId)
    .where(sql`${table.status} = 'active' AND ${table.deployment} = 'champion'`),
  index('idx_risk_rules_org_family_deployment').on(table.organizationId, table.familyId, table.deployment),
  index('idx_risk_rules_org_status_priority').on(table.organizationId, table.status, table.priority),
  check('risk_rules_kind', sql`${table.kind} IN ('amount_threshold', 'velocity_count', 'counterparty_match')`),
  check('risk_rules_operation', sql`${table.operationType} IN ('any', 'transfer', 'cash_in', 'cash_out')`),
  check('risk_rules_score', sql`${table.scoreDelta} BETWEEN 0 AND 100`),
  check('risk_rules_action', sql`${table.action} IN ('score', 'review', 'decline')`),
  check('risk_rules_priority', sql`${table.priority} BETWEEN 1 AND 1000`),
  check('risk_rules_status', sql`${table.status} IN ('active', 'disabled')`),
  check('risk_rules_version', sql`${table.version} > 0`),
  check('risk_rules_deployment', sql`${table.deployment} IN ('champion', 'challenger', 'archived')`),
]);

export const riskRulePromotions = pgTable('risk_rule_promotions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  ruleId: text('rule_id').notNull().references(() => riskRules.id, { onDelete: 'restrict' }),
  previousChampionId: text('previous_champion_id').references(() => riskRules.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  promotedBy: text('promoted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_rule_promotions_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_rule_promotions_org_created').on(table.organizationId, table.createdAt),
]);

export const riskSimulations = pgTable('risk_simulations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  candidateRuleId: text('candidate_rule_id').notNull().references(() => riskRules.id, { onDelete: 'restrict' }),
  baselineRuleId: text('baseline_rule_id').references(() => riskRules.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  sampleCount: integer('sample_count').notNull(), baselineSummary: text('baseline_summary').notNull(),
  candidateSummary: text('candidate_summary').notNull(), deltaSummary: text('delta_summary').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_simulations_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_simulations_org_created').on(table.organizationId, table.createdAt),
  check('risk_simulations_sample_count', sql`${table.sampleCount} BETWEEN 1 AND 50`),
]);

export const riskListEntries = pgTable('risk_list_entries', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  subjectType: text('subject_type').notNull(), subjectHash: text('subject_hash').notNull(), subjectPreview: text('subject_preview').notNull(),
  category: text('category').notNull(), reason: text('reason').notNull(), status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'), createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  disabledBy: text('disabled_by').references(() => users.id, { onDelete: 'restrict' }), disabledAt: text('disabled_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_list_entries_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_risk_list_entries_one_active_subject').on(table.organizationId, table.subjectType, table.subjectHash)
    .where(sql`${table.status} = 'active'`),
  index('idx_risk_list_entries_org_status_expiry').on(table.organizationId, table.status, table.expiresAt),
  check('risk_list_entries_subject_type', sql`${table.subjectType} IN ('counterparty', 'device', 'identity')`),
  check('risk_list_entries_category', sql`${table.category} IN ('allow', 'watch', 'block')`),
  check('risk_list_entries_status', sql`${table.status} IN ('active', 'disabled')`),
]);

export const riskEvaluations = pgTable('risk_evaluations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  operationType: text('operation_type').notNull(), resourceType: text('resource_type').notNull().default('transaction'), resourceId: text('resource_id'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(), counterparty: text('counterparty').notNull(),
  score: integer('score').notNull(), decision: text('decision').notNull(), matchedRuleIds: text('matched_rule_ids').notNull().default('[]'),
  matchedListEntryIds: text('matched_list_entry_ids').notNull().default('[]'), signals: text('signals').notNull().default('{}'),
  reasons: text('reasons').notNull().default('[]'), decisionLatencyMs: integer('decision_latency_ms'), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_evaluations_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_evaluations_org_created').on(table.organizationId, table.createdAt),
  index('idx_risk_evaluations_resource').on(table.organizationId, table.resourceId),
  check('risk_evaluations_operation', sql`${table.operationType} IN ('transfer', 'cash_in', 'cash_out')`),
  check('risk_evaluations_score', sql`${table.score} BETWEEN 0 AND 100`),
  check('risk_evaluations_decision', sql`${table.decision} IN ('approve', 'review', 'decline')`),
  check('risk_evaluations_latency', sql`${table.decisionLatencyMs} IS NULL OR ${table.decisionLatencyMs} >= 0`),
]);

export const riskStepUpChallenges = pgTable('risk_step_up_challenges', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  evaluationId: text('evaluation_id').notNull().references(() => riskEvaluations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  method: text('method').notNull().default('otp'), delivery: text('delivery').notNull().default('client_managed'),
  credentialHash: text('credential_hash').notNull(), credentialSalt: text('credential_salt').notNull(),
  credentialIterations: integer('credential_iterations').notNull(), credentialCiphertext: text('credential_ciphertext'),
  status: text('status').notNull().default('pending'), attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5), expiresAt: text('expires_at').notNull(),
  verifiedAt: text('verified_at'), failedAt: text('failed_at'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_step_up_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_risk_step_up_one_pending_evaluation').on(table.organizationId, table.evaluationId)
    .where(sql`${table.status} = 'pending'`),
  index('idx_risk_step_up_org_status_expiry').on(table.organizationId, table.status, table.expiresAt),
  index('idx_risk_step_up_evaluation_created').on(table.evaluationId, table.createdAt),
  check('risk_step_up_method', sql`${table.method} IN ('otp')`),
  check('risk_step_up_delivery', sql`${table.delivery} IN ('client_managed')`),
  check('risk_step_up_status', sql`${table.status} IN ('pending', 'verified', 'failed', 'expired', 'cancelled')`),
  check('risk_step_up_attempts', sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= ${table.maxAttempts}`),
  check('risk_step_up_max_attempts', sql`${table.maxAttempts} BETWEEN 1 AND 10`),
]);

export const riskStepUpAttempts = pgTable('risk_step_up_attempts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  challengeId: text('challenge_id').notNull().references(() => riskStepUpChallenges.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprintCiphertext: text('request_fingerprint_ciphertext').notNull(),
  attemptNumber: integer('attempt_number').notNull(), result: text('result').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_step_up_attempts_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_risk_step_up_attempts_challenge_created').on(table.challengeId, table.createdAt),
  check('risk_step_up_attempt_number', sql`${table.attemptNumber} > 0`),
  check('risk_step_up_attempt_result', sql`${table.result} IN ('matched', 'mismatch', 'expired', 'locked')`),
]);

export const riskCases = pgTable('risk_cases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  evaluationId: text('evaluation_id').notNull().references(() => riskEvaluations.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  holdId: text('hold_id').references(() => holds.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('open'), priority: text('priority').notNull().default('medium'),
  assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  dueAt: text('due_at'), escalatedAt: text('escalated_at'),
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
  ingestionMode: text('ingestion_mode').notNull().default('api'), fileName: text('file_name'), fileSha256: text('file_sha256'),
  periodStart: text('period_start').notNull(), periodEnd: text('period_end').notNull(), status: text('status').notNull().default('open'),
  expectedMinor: bigint('expected_minor', { mode: 'bigint' }).notNull().default(sql`0`), actualMinor: bigint('actual_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  differenceMinor: bigint('difference_minor', { mode: 'bigint' }).notNull().default(sql`0`), matchedCount: integer('matched_count').notNull().default(0),
  exceptionCount: integer('exception_count').notNull().default(0), createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_reconciliation_runs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_reconciliation_runs_org_created').on(table.organizationId, table.createdAt),
  check('reconciliation_runs_source', sql`${table.source} IN ('bank', 'clearing', 'card_network', 'cash_network', 'internal')`),
  check('reconciliation_runs_ingestion', sql`${table.ingestionMode} IN ('api', 'csv')`),
  check('reconciliation_runs_status', sql`${table.status} IN ('open', 'completed')`),
  check('reconciliation_runs_counts', sql`${table.matchedCount} >= 0 AND ${table.exceptionCount} >= 0`),
]);

export const settlementCycles = pgTable('settlement_cycles', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  reconciliationRunId: text('reconciliation_run_id').notNull().references(() => reconciliationRuns.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  name: text('name').notNull(), rail: text('rail').notNull(), currency: text('currency').notNull(),
  periodStart: text('period_start').notNull(), periodEnd: text('period_end').notNull(),
  netMinor: bigint('net_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  differenceMinor: bigint('difference_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  status: text('status').notNull().default('ready'), scheduledFor: text('scheduled_for'),
  executionIdempotencyKey: text('execution_idempotency_key'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  settledBy: text('settled_by').references(() => users.id, { onDelete: 'restrict' }), settledAt: text('settled_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_settlement_cycles_run').on(table.reconciliationRunId),
  uniqueIndex('idx_settlement_cycles_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_settlement_cycles_org_execution_idempotency').on(table.organizationId, table.executionIdempotencyKey),
  index('idx_settlement_cycles_org_status_schedule').on(table.organizationId, table.status, table.scheduledFor),
  check('settlement_cycles_rail', sql`${table.rail} IN ('bank', 'clearing', 'card_network', 'cash_network', 'internal')`),
  check('settlement_cycles_status', sql`${table.status} IN ('ready', 'scheduled', 'settled')`),
]);

export const disputes = pgTable('disputes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  reason: text('reason').notNull(), description: text('description').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  status: text('status').notNull().default('opened'), priority: text('priority').notNull().default('medium'),
  provisionalCreditRequested: integer('provisional_credit_requested').notNull().default(0),
  creditStatus: text('credit_status').notNull().default('none'),
  creditAccountId: text('credit_account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
  creditTransactionId: text('credit_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  creditReversalTransactionId: text('credit_reversal_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  dueAt: text('due_at'), escalatedAt: text('escalated_at'),
  openedBy: text('opened_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }),
  resolutionNote: text('resolution_note'), resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_disputes_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_disputes_org_transaction').on(table.organizationId, table.transactionId),
  index('idx_disputes_org_status_created').on(table.organizationId, table.status, table.createdAt),
  check('disputes_reason', sql`${table.reason} IN ('card_not_present', 'duplicate', 'amount_mismatch', 'service_not_received', 'credit_not_processed', 'cash_not_received', 'other')`),
  check('disputes_status', sql`${table.status} IN ('opened', 'under_review', 'network_ready', 'won', 'lost', 'rejected', 'cancelled')`),
  check('disputes_priority', sql`${table.priority} IN ('low', 'medium', 'high', 'critical')`),
  check('disputes_amount_positive', sql`${table.amountMinor} > 0`),
  check('disputes_provisional_credit', sql`${table.provisionalCreditRequested} IN (0, 1)`),
  check('disputes_credit_status', sql`${table.creditStatus} IN ('none', 'posted', 'final', 'reversed')`),
]);

export const disputeEvents = pgTable('dispute_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  disputeId: text('dispute_id').notNull().references(() => disputes.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  event: text('event').notNull(), fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
  note: text('note').notNull().default(''), actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_dispute_events_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_dispute_events_dispute_created').on(table.disputeId, table.createdAt),
  check('dispute_events_event', sql`${table.event} IN ('created', 'start_review', 'mark_network_ready', 'resolve_won', 'resolve_lost', 'reject', 'cancel')`),
]);

export const approvalPolicies = pgTable('approval_policies', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(), enabled: integer('enabled').notNull().default(0),
  expiresInMinutes: integer('expires_in_minutes').notNull().default(1440),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_approval_policies_org_action').on(table.organizationId, table.actionType),
  check('approval_policies_action', sql`${table.actionType} IN ('settlement.execute', 'transfer.create', 'payout_batch.execute', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve')`),
  check('approval_policies_enabled', sql`${table.enabled} IN (0, 1)`),
  check('approval_policies_expiry', sql`${table.expiresInMinutes} BETWEEN 15 AND 10080`),
]);

export const approvalRequests = pgTable('approval_requests', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(), resourceType: text('resource_type').notNull(), resourceId: text('resource_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  status: text('status').notNull().default('pending'), requestPayload: text('request_payload').notNull().default('{}'),
  requestedBy: text('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }), resolutionReason: text('resolution_reason'),
  expiresAt: text('expires_at').notNull(), resolvedAt: text('resolved_at'), executedAt: text('executed_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_approval_requests_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_approval_requests_org_status').on(table.organizationId, table.status, table.createdAt),
  index('idx_approval_requests_org_resource').on(table.organizationId, table.actionType, table.resourceId),
  check('approval_requests_action_resource', sql`(
    (${table.actionType} = 'settlement.execute' AND ${table.resourceType} = 'settlement_cycle') OR
    (${table.actionType} = 'transfer.create' AND ${table.resourceType} IN ('transfer', 'book_transfer')) OR
    (${table.actionType} = 'payout_batch.execute' AND ${table.resourceType} = 'payout_batch') OR
    (${table.actionType} = 'risk.case.resolve' AND ${table.resourceType} = 'risk_case') OR
    (${table.actionType} = 'reconciliation.exception.resolve' AND ${table.resourceType} = 'reconciliation_exception') OR
    (${table.actionType} = 'dispute.resolve' AND ${table.resourceType} = 'dispute')
  )`),
  check('approval_requests_status', sql`${table.status} IN ('pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed')`),
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
  priority: text('priority').notNull().default('medium'), assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  dueAt: text('due_at'), escalatedAt: text('escalated_at'),
  resolution: text('resolution'), resolutionNote: text('resolution_note'), resolutionIdempotencyKey: text('resolution_idempotency_key'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'restrict' }), resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_reconciliation_exceptions_item').on(table.itemId),
  uniqueIndex('idx_reconciliation_exceptions_org_resolution_idempotency').on(table.organizationId, table.resolutionIdempotencyKey),
  index('idx_reconciliation_exceptions_org_status_created').on(table.organizationId, table.status, table.createdAt),
  check('reconciliation_exceptions_kind', sql`${table.kind} IN ('amount_mismatch', 'missing_internal', 'missing_external')`),
  check('reconciliation_exceptions_status', sql`${table.status} IN ('open', 'resolved', 'accepted')`),
  check('reconciliation_exceptions_priority', sql`${table.priority} IN ('low', 'medium', 'high', 'critical')`),
  check('reconciliation_exceptions_resolution', sql`${table.resolution} IS NULL OR ${table.resolution} IN ('corrected', 'accepted')`),
]);

export const riskOutcomes = pgTable('risk_outcomes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  evaluationId: text('evaluation_id').notNull().references(() => riskEvaluations.id, { onDelete: 'cascade' }),
  supersedesOutcomeId: text('supersedes_outcome_id').references((): AnyPgColumn => riskOutcomes.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  label: text('label').notNull(), fraudType: text('fraud_type'), lossAmountMinor: bigint('loss_amount_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  currency: text('currency').notNull(), note: text('note').notNull(), status: text('status').notNull().default('active'),
  reportedBy: text('reported_by').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_risk_outcomes_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_risk_outcomes_one_active_evaluation').on(table.organizationId, table.evaluationId)
    .where(sql`${table.status} = 'active'`),
  index('idx_risk_outcomes_org_created').on(table.organizationId, table.createdAt),
  check('risk_outcomes_label', sql`${table.label} IN ('legitimate', 'fraud')`),
  check('risk_outcomes_fraud_type', sql`${table.fraudType} IS NULL OR ${table.fraudType} IN ('account_takeover', 'identity_fraud', 'scam', 'stolen_instrument', 'merchant_fraud', 'other')`),
  check('risk_outcomes_status', sql`${table.status} IN ('active', 'superseded')`),
  check('risk_outcomes_loss', sql`${table.lossAmountMinor} >= 0`),
  check('risk_outcomes_consistency', sql`(${table.label} = 'legitimate' AND ${table.fraudType} IS NULL AND ${table.lossAmountMinor} = 0) OR (${table.label} = 'fraud' AND ${table.fraudType} IS NOT NULL)`),
]);

export const operationalActions = pgTable('operational_actions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  subjectType: text('subject_type').notNull(), subjectId: text('subject_id').notNull(), action: text('action').notNull(),
  payload: text('payload').notNull().default('{}'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_operational_actions_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_operational_actions_subject').on(table.organizationId, table.subjectType, table.subjectId, table.createdAt),
  check('operational_actions_subject', sql`${table.subjectType} IN ('risk_case', 'reconciliation_exception', 'dispute')`),
  check('operational_actions_action', sql`${table.action} IN ('update', 'note', 'evidence')`),
]);

export const operationalNotes = pgTable('operational_notes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(), subjectId: text('subject_id').notNull(), body: text('body').notNull(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  actionId: text('action_id').notNull().references(() => operationalActions.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_operational_notes_action').on(table.actionId),
  index('idx_operational_notes_subject').on(table.organizationId, table.subjectType, table.subjectId, table.createdAt),
  check('operational_notes_subject', sql`${table.subjectType} IN ('risk_case', 'reconciliation_exception', 'dispute')`),
]);

export const operationalEvidenceLinks = pgTable('operational_evidence_links', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(), subjectId: text('subject_id').notNull(),
  documentId: text('document_id').notNull().references(() => complianceDocuments.id, { onDelete: 'restrict' }),
  linkedBy: text('linked_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  actionId: text('action_id').notNull().references(() => operationalActions.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_operational_evidence_action').on(table.actionId),
  uniqueIndex('idx_operational_evidence_subject_document').on(table.organizationId, table.subjectType, table.subjectId, table.documentId),
  index('idx_operational_evidence_subject').on(table.organizationId, table.subjectType, table.subjectId, table.createdAt),
  check('operational_evidence_subject', sql`${table.subjectType} IN ('risk_case', 'reconciliation_exception', 'dispute')`),
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

export const walletPrograms = pgTable('wallet_programs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  name: text('name').notNull(), displayName: text('display_name').notNull(),
  supportUrl: text('support_url'), termsUrl: text('terms_url'), accentColor: text('accent_color'),
  defaultCurrency: text('default_currency').notNull(), allowedCurrencies: text('allowed_currencies').notNull(),
  pocketKinds: text('pocket_kinds').notNull(), status: text('status').notNull().default('active'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_wallet_programs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_wallet_programs_org_name').on(table.organizationId, table.name),
  index('idx_wallet_programs_org_created').on(table.organizationId, table.createdAt),
  check('wallet_programs_status', sql`${table.status} IN ('active', 'inactive')`),
  check('wallet_programs_currency', sql`${table.defaultCurrency} IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')`),
]);

export const wallets = pgTable('wallets', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  programId: text('program_id').notNull().references(() => walletPrograms.id, { onDelete: 'restrict' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  externalReference: text('external_reference').notNull(), status: text('status').notNull().default('active'),
  statusReason: text('status_reason'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_wallets_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_wallets_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_wallets_org_program_customer').on(table.organizationId, table.programId, table.customerId),
  index('idx_wallets_org_created').on(table.organizationId, table.createdAt),
  index('idx_wallets_customer').on(table.customerId),
  check('wallets_status', sql`${table.status} IN ('active', 'frozen', 'closed')`),
]);

export const walletPockets = pgTable('wallet_pockets', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  walletId: text('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(), label: text('label').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_wallet_pockets_wallet_kind').on(table.walletId, table.kind),
  uniqueIndex('idx_wallet_pockets_account').on(table.accountId),
  index('idx_wallet_pockets_org_wallet').on(table.organizationId, table.walletId),
  check('wallet_pockets_kind', sql`${table.kind} IN ('available', 'pending', 'rewards')`),
]);

export const walletLifecycleEvents = pgTable('wallet_lifecycle_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  walletId: text('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  fromStatus: text('from_status'), toStatus: text('to_status').notNull(), reason: text('reason').notNull(),
  actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }), createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_wallet_lifecycle_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_wallet_lifecycle_wallet_created').on(table.walletId, table.createdAt),
  check('wallet_lifecycle_from_status', sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('active', 'frozen', 'closed')`),
  check('wallet_lifecycle_to_status', sql`${table.toStatus} IN ('active', 'frozen', 'closed')`),
]);

export const railInstruments = pgTable('rail_instruments', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  kind: text('kind').notNull(), value: text('value').notNull(),
  holderName: text('holder_name').notNull(), taxIdLast4: text('tax_id_last4').notNull(),
  status: text('status').notNull().default('active'),
  assignIdempotencyKey: text('assign_idempotency_key'),
  revokeIdempotencyKey: text('revoke_idempotency_key'),
  valueChangedAt: text('value_changed_at'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_rail_instruments_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_rail_instruments_org_value').on(table.organizationId, table.value),
  uniqueIndex('idx_rail_instruments_account_kind').on(table.accountId, table.kind),
  uniqueIndex('idx_rail_instruments_org_assign_idempotency').on(table.organizationId, table.assignIdempotencyKey).where(sql`${table.assignIdempotencyKey} IS NOT NULL`),
  uniqueIndex('idx_rail_instruments_org_revoke_idempotency').on(table.organizationId, table.revokeIdempotencyKey).where(sql`${table.revokeIdempotencyKey} IS NOT NULL`),
  index('idx_rail_instruments_org_created').on(table.organizationId, table.createdAt),
  check('rail_instruments_kind', sql`${table.kind} IN ('cvu', 'alias')`),
  check('rail_instruments_status', sql`${table.status} IN ('active', 'revoked')`),
]);

export const instantTransfers = pgTable('instant_transfers', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  scheme: text('scheme').notNull(), direction: text('direction').notNull(),
  sourceAccountId: text('source_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  destinationAccountId: text('destination_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  counterpartyKind: text('counterparty_kind').notNull(), counterpartyHash: text('counterparty_hash').notNull(),
  counterpartyLast4: text('counterparty_last4').notNull(), counterpartyHolderName: text('counterparty_holder_name'),
  counterpartyTaxLast4: text('counterparty_tax_last4'),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  description: text('description').notNull(), externalReference: text('external_reference').notNull(),
  status: text('status').notNull(), rail: text('rail').notNull().default('cimbra_sandbox'),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  reversalTransactionId: text('reversal_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  qrPayload: text('qr_payload'), expiresAt: text('expires_at'),
  collectionTillId: text('collection_till_id').references((): AnyPgColumn => collectionTills.id, { onDelete: 'restrict' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_instant_transfers_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_instant_transfers_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_instant_transfers_transaction').on(table.transactionId),
  uniqueIndex('idx_instant_transfers_reversal').on(table.reversalTransactionId),
  index('idx_instant_transfers_org_created').on(table.organizationId, table.createdAt),
  index('idx_instant_transfers_org_scheme').on(table.organizationId, table.scheme, table.createdAt),
  index('idx_instant_transfers_collection_till').on(table.collectionTillId),
  check('instant_transfers_scheme', sql`${table.scheme} IN ('credit_push', 'debit_pull', 'qr_collect')`),
  check('instant_transfers_direction', sql`${table.direction} IN ('outbound', 'inbound', 'internal')`),
  check('instant_transfers_counterparty_kind', sql`${table.counterpartyKind} IN ('cvu', 'cbu', 'alias')`),
  check('instant_transfers_status', sql`${table.status} IN ('pending', 'accepted', 'rejected', 'settled', 'returned', 'expired', 'cancelled')`),
  check('instant_transfers_currency', sql`${table.currency} = 'ARS'`),
  check('instant_transfers_amount_positive', sql`${table.amountMinor} > 0`),
]);

export const paymentQrs = pgTable('payment_qrs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }), currency: text('currency').notNull(),
  description: text('description').notNull(), payload: text('payload').notNull(),
  kind: text('kind').notNull().default('dynamic'),
  status: text('status').notNull().default('active'), expiresAt: text('expires_at'),
  paidTransferId: text('paid_transfer_id').references(() => instantTransfers.id, { onDelete: 'restrict' }),
  cancelIdempotencyKey: text('cancel_idempotency_key'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payment_qrs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_payment_qrs_payload').on(table.payload),
  uniqueIndex('idx_payment_qrs_account_active_static').on(table.accountId).where(sql`${table.kind} = 'static' AND ${table.status} = 'active'`),
  uniqueIndex('idx_payment_qrs_org_cancel_idempotency').on(table.organizationId, table.cancelIdempotencyKey).where(sql`${table.cancelIdempotencyKey} IS NOT NULL`),
  index('idx_payment_qrs_org_created').on(table.organizationId, table.createdAt),
  check('payment_qrs_currency', sql`${table.currency} = 'ARS'`),
  check('payment_qrs_kind', sql`${table.kind} IN ('dynamic', 'static', 'debt')`),
  check('payment_qrs_status', sql`${table.status} IN ('active', 'paid', 'expired', 'cancelled')`),
  check('payment_qrs_amount_positive', sql`${table.amountMinor} IS NULL OR ${table.amountMinor} > 0`),
  check('payment_qrs_static_open', sql`${table.kind} <> 'static' OR ${table.amountMinor} IS NULL`),
  check('payment_qrs_debt_closed', sql`${table.kind} <> 'debt' OR ${table.amountMinor} IS NOT NULL`),
  check('payment_qrs_expires_shape', sql`(${table.kind} = 'static' AND ${table.expiresAt} IS NULL) OR (${table.kind} IN ('dynamic', 'debt') AND ${table.expiresAt} IS NOT NULL)`),
]);

export const qrSaleOrders = pgTable('qr_sale_orders', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  paymentQrId: text('payment_qr_id').notNull().references(() => paymentQrs.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  description: text('description').notNull(), externalReference: text('external_reference').notNull(),
  status: text('status').notNull().default('pending'), expiresAt: text('expires_at').notNull(),
  paidTransferId: text('paid_transfer_id').references(() => instantTransfers.id, { onDelete: 'restrict' }),
  cancelIdempotencyKey: text('cancel_idempotency_key'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_qr_sale_orders_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_qr_sale_orders_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_qr_sale_orders_qr_pending').on(table.paymentQrId).where(sql`${table.status} = 'pending'`),
  uniqueIndex('idx_qr_sale_orders_org_cancel_idempotency').on(table.organizationId, table.cancelIdempotencyKey).where(sql`${table.cancelIdempotencyKey} IS NOT NULL`),
  index('idx_qr_sale_orders_org_created').on(table.organizationId, table.createdAt),
  check('qr_sale_orders_currency', sql`${table.currency} = 'ARS'`),
  check('qr_sale_orders_status', sql`${table.status} IN ('pending', 'paid', 'expired', 'cancelled', 'superseded')`),
  check('qr_sale_orders_amount_positive', sql`${table.amountMinor} > 0`),
]);

export const qrDebts = pgTable('qr_debts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  paymentQrId: text('payment_qr_id').notNull().references(() => paymentQrs.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  description: text('description').notNull(), externalReference: text('external_reference').notNull(),
  status: text('status').notNull().default('open'),
  expiresAt: text('expires_at').notNull(),
  paidTransferId: text('paid_transfer_id').references(() => instantTransfers.id, { onDelete: 'restrict' }),
  cancelIdempotencyKey: text('cancel_idempotency_key'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_qr_debts_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_qr_debts_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_qr_debts_payment_qr').on(table.paymentQrId),
  uniqueIndex('idx_qr_debts_org_cancel_idempotency').on(table.organizationId, table.cancelIdempotencyKey).where(sql`${table.cancelIdempotencyKey} IS NOT NULL`),
  index('idx_qr_debts_org_created').on(table.organizationId, table.createdAt),
  check('qr_debts_currency', sql`${table.currency} = 'ARS'`),
  check('qr_debts_status', sql`${table.status} IN ('open', 'paid', 'expired', 'cancelled')`),
  check('qr_debts_amount_positive', sql`${table.amountMinor} > 0`),
]);

export const paymentLinks = pgTable('payment_links', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  description: text('description').notNull(), externalReference: text('external_reference').notNull(),
  allowedMethods: text('allowed_methods').notNull(), payload: text('payload').notNull(),
  status: text('status').notNull().default('open'), expiresAt: text('expires_at').notNull(),
  paidMethod: text('paid_method'), payerAccountId: text('payer_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  reversalTransactionId: text('reversal_transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  payIdempotencyKey: text('pay_idempotency_key'), payFingerprint: text('pay_fingerprint'),
  refundIdempotencyKey: text('refund_idempotency_key'),
  qrDebtId: text('qr_debt_id').references(() => qrDebts.id, { onDelete: 'restrict' }),
  collectionTillId: text('collection_till_id').references((): AnyPgColumn => collectionTills.id, { onDelete: 'restrict' }),
  collectedMinor: bigint('collected_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  items: text('items').notNull().default('[]'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payment_links_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_payment_links_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_payment_links_payload').on(table.payload),
  uniqueIndex('idx_payment_links_transaction').on(table.transactionId),
  uniqueIndex('idx_payment_links_reversal').on(table.reversalTransactionId),
  uniqueIndex('idx_payment_links_org_pay_idempotency').on(table.organizationId, table.payIdempotencyKey),
  uniqueIndex('idx_payment_links_org_refund_idempotency').on(table.organizationId, table.refundIdempotencyKey),
  uniqueIndex('idx_payment_links_qr_debt').on(table.qrDebtId).where(sql`${table.qrDebtId} IS NOT NULL`),
  index('idx_payment_links_org_created').on(table.organizationId, table.createdAt),
  index('idx_payment_links_collection_till').on(table.collectionTillId),
  check('payment_links_currency', sql`${table.currency} = 'ARS'`),
  check('payment_links_status', sql`${table.status} IN ('open', 'pending', 'paid', 'expired', 'cancelled', 'refunded')`),
  check('payment_links_paid_method', sql`${table.paidMethod} IS NULL OR ${table.paidMethod} IN ('internal', 'sandbox_inbound', 'cimbra_qr', 'cimbra_cvu')`),
  check('payment_links_amount_positive', sql`${table.amountMinor} > 0`),
  check('payment_links_collected_nonnegative', sql`${table.collectedMinor} >= 0`),
  check('payment_links_items_array', sql`jsonb_typeof(${table.items}::jsonb) = 'array'`),
]);

export const paymentLinkCredits = pgTable('payment_link_credits', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  paymentLinkId: text('payment_link_id').notNull().references(() => paymentLinks.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  method: text('method').notNull(),
  payerAccountId: text('payer_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'restrict' }),
  instantTransferId: text('instant_transfer_id').references(() => instantTransfers.id, { onDelete: 'restrict' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_payment_link_credits_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_payment_link_credits_transaction').on(table.transactionId),
  uniqueIndex('idx_payment_link_credits_transfer').on(table.instantTransferId).where(sql`${table.instantTransferId} IS NOT NULL`),
  index('idx_payment_link_credits_link_created').on(table.paymentLinkId, table.createdAt),
  check('payment_link_credits_method', sql`${table.method} = 'cimbra_cvu'`),
  check('payment_link_credits_amount_positive', sql`${table.amountMinor} > 0`),
]);

export const collectionTills = pgTable('collection_tills', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  paymentQrId: text('payment_qr_id').references(() => paymentQrs.id, { onDelete: 'restrict' }),
  name: text('name').notNull(), externalReference: text('external_reference').notNull(),
  cvu: text('cvu').notNull(), alias: text('alias'), aliasChangedAt: text('alias_changed_at'),
  status: text('status').notNull().default('active'),
  assignIdempotencyKey: text('assign_idempotency_key'),
  cancelIdempotencyKey: text('cancel_idempotency_key'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_collection_tills_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_collection_tills_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_collection_tills_cvu').on(table.cvu),
  uniqueIndex('idx_collection_tills_org_alias').on(table.organizationId, table.alias).where(sql`${table.alias} IS NOT NULL`),
  uniqueIndex('idx_collection_tills_payment_qr').on(table.paymentQrId).where(sql`${table.paymentQrId} IS NOT NULL`),
  uniqueIndex('idx_collection_tills_org_assign_idempotency').on(table.organizationId, table.assignIdempotencyKey).where(sql`${table.assignIdempotencyKey} IS NOT NULL`),
  uniqueIndex('idx_collection_tills_org_cancel_idempotency').on(table.organizationId, table.cancelIdempotencyKey).where(sql`${table.cancelIdempotencyKey} IS NOT NULL`),
  index('idx_collection_tills_org_created').on(table.organizationId, table.createdAt),
  check('collection_tills_status', sql`${table.status} IN ('active', 'disabled')`),
]);

export const echeqs = pgTable('echeqs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  drawerAccountId: text('drawer_account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  holderAccountId: text('holder_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(), currency: text('currency').notNull(),
  description: text('description').notNull(), externalReference: text('external_reference').notNull(),
  payload: text('payload').notNull(), toOrder: integer('to_order').notNull().default(1),
  paymentDate: text('payment_date').notNull(), expiresAt: text('expires_at').notNull(),
  status: text('status').notNull().default('issued'),
  beneficiaryName: text('beneficiary_name').notNull(),
  beneficiaryTaxHash: text('beneficiary_tax_hash').notNull(), beneficiaryTaxLast4: text('beneficiary_tax_last4').notNull(),
  endorsementCount: integer('endorsement_count').notNull().default(0),
  rejectReason: text('reject_reason'),
  transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'restrict' }),
  acceptIdempotencyKey: text('accept_idempotency_key'), acceptFingerprint: text('accept_fingerprint'),
  endorseIdempotencyKey: text('endorse_idempotency_key'), endorseFingerprint: text('endorse_fingerprint'),
  depositIdempotencyKey: text('deposit_idempotency_key'), depositFingerprint: text('deposit_fingerprint'),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_echeqs_org_idempotency').on(table.organizationId, table.idempotencyKey),
  uniqueIndex('idx_echeqs_org_reference').on(table.organizationId, table.externalReference),
  uniqueIndex('idx_echeqs_payload').on(table.payload),
  uniqueIndex('idx_echeqs_transaction').on(table.transactionId),
  uniqueIndex('idx_echeqs_org_accept_idempotency').on(table.organizationId, table.acceptIdempotencyKey),
  uniqueIndex('idx_echeqs_org_endorse_idempotency').on(table.organizationId, table.endorseIdempotencyKey),
  uniqueIndex('idx_echeqs_org_deposit_idempotency').on(table.organizationId, table.depositIdempotencyKey),
  index('idx_echeqs_org_created').on(table.organizationId, table.createdAt),
  check('echeqs_currency', sql`${table.currency} = 'ARS'`),
  check('echeqs_status', sql`${table.status} IN ('issued', 'accepted', 'endorsed', 'pending', 'deposited', 'cancelled', 'returned', 'rejected', 'expired')`),
  check('echeqs_amount_positive', sql`${table.amountMinor} > 0`),
  check('echeqs_to_order', sql`${table.toOrder} IN (0, 1)`),
  check('echeqs_tax_last4', sql`length(${table.beneficiaryTaxLast4}) = 4`),
]);

export const platformRails = pgTable('platform_rails', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('integracion'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_platform_rails_status').on(table.status),
  check('platform_rails_status', sql`${table.status} IN ('integracion', 'homologacion', 'go_live')`),
]);

export const officialRailConnections = pgTable('official_rail_connections', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('unwired'),
  evidenceNote: text('evidence_note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_official_rail_connections_status').on(table.status),
  check('official_rail_connections_status', sql`${table.status} IN ('unwired', 'contracted', 'certified', 'live')`),
]);

export const echeqEndorsements = pgTable('echeq_endorsements', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  echeqId: text('echeq_id').notNull().references(() => echeqs.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(), requestFingerprint: text('request_fingerprint').notNull(),
  beneficiaryName: text('beneficiary_name').notNull(),
  beneficiaryTaxHash: text('beneficiary_tax_hash').notNull(), beneficiaryTaxLast4: text('beneficiary_tax_last4').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_echeq_endorsements_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_echeq_endorsements_echeq_created').on(table.echeqId, table.createdAt),
]);
