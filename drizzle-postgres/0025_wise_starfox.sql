CREATE TABLE "payout_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"external_reference" text NOT NULL,
	"description" text NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"item_count" integer NOT NULL,
	"scheduled_for" text,
	"process_before" text,
	"processing_lease_until" text,
	"submitted_at" text,
	"started_at" text,
	"completed_at" text,
	"cancelled_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "payout_batches_status" CHECK ("payout_batches"."status" IN ('draft', 'pending_approval', 'scheduled', 'processing', 'requires_attention', 'completed', 'partially_failed', 'failed', 'cancelled')),
	CONSTRAINT "payout_batches_currency" CHECK ("payout_batches"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "payout_batches_total_positive" CHECK ("payout_batches"."total_amount_minor" > 0),
	CONSTRAINT "payout_batches_item_count" CHECK ("payout_batches"."item_count" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "payout_beneficiaries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"external_reference" text NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"destination_type" text NOT NULL,
	"destination_hash" text NOT NULL,
	"destination_last4" text NOT NULL,
	"bank_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "payout_beneficiaries_entity_type" CHECK ("payout_beneficiaries"."entity_type" IN ('individual', 'business')),
	CONSTRAINT "payout_beneficiaries_destination_type" CHECK ("payout_beneficiaries"."destination_type" IN ('local_account', 'alias', 'iban', 'clabe', 'pix_key')),
	CONSTRAINT "payout_beneficiaries_status" CHECK ("payout_beneficiaries"."status" IN ('active', 'suspended')),
	CONSTRAINT "payout_beneficiaries_currency" CHECK ("payout_beneficiaries"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN'))
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"beneficiary_id" text NOT NULL,
	"external_reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_id" text,
	"failure_code" text,
	"failure_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "payout_items_status" CHECK ("payout_items"."status" IN ('pending', 'processing', 'review', 'settled', 'failed', 'cancelled')),
	CONSTRAINT "payout_items_currency" CHECK ("payout_items"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "payout_items_amount_positive" CHECK ("payout_items"."amount_minor" > 0),
	CONSTRAINT "payout_items_attempts" CHECK ("payout_items"."attempt_count" BETWEEN 0 AND 3)
);
--> statement-breakpoint
ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_action";--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_action_resource";--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_beneficiaries" ADD CONSTRAINT "payout_beneficiaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_beneficiaries" ADD CONSTRAINT "payout_beneficiaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_beneficiary_id_payout_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."payout_beneficiaries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_batches_org_idempotency" ON "payout_batches" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_batches_org_reference" ON "payout_batches" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE INDEX "idx_payout_batches_org_status_schedule" ON "payout_batches" USING btree ("organization_id","status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_beneficiaries_org_idempotency" ON "payout_beneficiaries" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_beneficiaries_org_reference" ON "payout_beneficiaries" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_beneficiaries_org_destination" ON "payout_beneficiaries" USING btree ("organization_id","destination_hash");--> statement-breakpoint
CREATE INDEX "idx_payout_beneficiaries_org_status" ON "payout_beneficiaries" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_items_batch_reference" ON "payout_items" USING btree ("batch_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payout_items_transaction" ON "payout_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_payout_items_batch_status" ON "payout_items" USING btree ("batch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_payout_items_org_created" ON "payout_items" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_action" CHECK ("approval_policies"."action_type" IN ('settlement.execute', 'transfer.create', 'payout_batch.execute', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_resource" CHECK ((
    ("approval_requests"."action_type" = 'settlement.execute' AND "approval_requests"."resource_type" = 'settlement_cycle') OR
    ("approval_requests"."action_type" = 'transfer.create' AND "approval_requests"."resource_type" = 'transfer') OR
    ("approval_requests"."action_type" = 'payout_batch.execute' AND "approval_requests"."resource_type" = 'payout_batch') OR
    ("approval_requests"."action_type" = 'risk.case.resolve' AND "approval_requests"."resource_type" = 'risk_case') OR
    ("approval_requests"."action_type" = 'reconciliation.exception.resolve' AND "approval_requests"."resource_type" = 'reconciliation_exception') OR
    ("approval_requests"."action_type" = 'dispute.resolve' AND "approval_requests"."resource_type" = 'dispute')
  ));