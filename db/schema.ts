import { doublePrecision, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

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
  amount: doublePrecision('amount').notNull(), currency: text('currency').notNull().default('ARS'),
  status: text('status').notNull().default('pending'), riskScore: integer('risk_score').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_transactions_org_idempotency').on(table.organizationId, table.idempotencyKey),
  index('idx_transactions_org_created').on(table.organizationId, table.createdAt),
  index('idx_transactions_org_status').on(table.organizationId, table.status),
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

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  currency: text('currency').notNull(), country: text('country').notNull(), accountReference: text('account_reference').notNull(),
  balance: doublePrecision('balance').notNull().default(0), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(),
}, (table) => [index('idx_accounts_org_created').on(table.organizationId, table.createdAt), index('idx_accounts_customer').on(table.customerId)]);

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
