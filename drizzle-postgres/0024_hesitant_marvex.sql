CREATE TABLE "bill_payment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"biller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"obligation_id" text,
	"mandate_id" text,
	"transaction_id" text,
	"reversal_transaction_id" text,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"service_type" text NOT NULL,
	"destination_reference_hash" text NOT NULL,
	"destination_reference_last4" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"settled_at" text,
	"reversed_at" text,
	CONSTRAINT "bill_payment_orders_service_type" CHECK ("bill_payment_orders"."service_type" IN ('bill_payment', 'mobile_topup', 'gift_card')),
	CONSTRAINT "bill_payment_orders_amount_positive" CHECK ("bill_payment_orders"."amount_minor" > 0),
	CONSTRAINT "bill_payment_orders_currency" CHECK ("bill_payment_orders"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "bill_payment_orders_status" CHECK ("bill_payment_orders"."status" IN ('declined', 'review', 'settled', 'reversed', 'cancelled')),
	CONSTRAINT "bill_payment_orders_reference_last4" CHECK (length("bill_payment_orders"."destination_reference_last4") = 4)
);
--> statement-breakpoint
CREATE TABLE "biller_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"biller_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"external_reference" text NOT NULL,
	"subscriber_reference_hash" text NOT NULL,
	"subscriber_reference_last4" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"due_at" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"paid_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "biller_obligations_amount_positive" CHECK ("biller_obligations"."amount_minor" > 0),
	CONSTRAINT "biller_obligations_currency" CHECK ("biller_obligations"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "biller_obligations_status" CHECK ("biller_obligations"."status" IN ('open', 'paid', 'cancelled', 'expired')),
	CONSTRAINT "biller_obligations_reference_last4" CHECK (length("biller_obligations"."subscriber_reference_last4") = 4)
);
--> statement-breakpoint
CREATE TABLE "billers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"category" text NOT NULL,
	"service_type" text NOT NULL,
	"currency" text NOT NULL,
	"amount_mode" text NOT NULL,
	"min_amount_minor" bigint,
	"max_amount_minor" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"contract_reference" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "billers_country" CHECK (length("billers"."country") = 2),
	CONSTRAINT "billers_category" CHECK ("billers"."category" IN ('utilities', 'telecom', 'tax', 'education', 'health', 'insurance', 'transport', 'entertainment', 'other')),
	CONSTRAINT "billers_service_type" CHECK ("billers"."service_type" IN ('bill_payment', 'mobile_topup', 'gift_card')),
	CONSTRAINT "billers_currency" CHECK ("billers"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "billers_amount_mode" CHECK ("billers"."amount_mode" IN ('exact', 'range', 'fixed')),
	CONSTRAINT "billers_amount_range" CHECK (("billers"."min_amount_minor" IS NULL OR "billers"."min_amount_minor" > 0) AND ("billers"."max_amount_minor" IS NULL OR "billers"."max_amount_minor" > 0) AND ("billers"."min_amount_minor" IS NULL OR "billers"."max_amount_minor" IS NULL OR "billers"."min_amount_minor" <= "billers"."max_amount_minor")),
	CONSTRAINT "billers_status" CHECK ("billers"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "recurring_payment_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mandate_id" text NOT NULL,
	"order_id" text,
	"scheduled_for" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"attempted_at" text NOT NULL,
	CONSTRAINT "recurring_executions_status" CHECK ("recurring_payment_executions"."status" IN ('settled', 'review', 'declined', 'skipped_no_debt', 'failed')),
	CONSTRAINT "recurring_executions_attempt" CHECK ("recurring_payment_executions"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_payment_mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"biller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"subscriber_reference_hash" text NOT NULL,
	"subscriber_reference_last4" text NOT NULL,
	"frequency" text NOT NULL,
	"amount_minor" bigint,
	"amount_limit_minor" bigint NOT NULL,
	"consent_reference" text NOT NULL,
	"consented_at" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_charge_at" text NOT NULL,
	"pending_scheduled_for" text,
	"last_executed_at" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"cancelled_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "recurring_mandates_frequency" CHECK ("recurring_payment_mandates"."frequency" IN ('weekly', 'monthly')),
	CONSTRAINT "recurring_mandates_amounts" CHECK ("recurring_payment_mandates"."amount_limit_minor" > 0 AND ("recurring_payment_mandates"."amount_minor" IS NULL OR "recurring_payment_mandates"."amount_minor" > 0) AND ("recurring_payment_mandates"."amount_minor" IS NULL OR "recurring_payment_mandates"."amount_minor" <= "recurring_payment_mandates"."amount_limit_minor")),
	CONSTRAINT "recurring_mandates_status" CHECK ("recurring_payment_mandates"."status" IN ('active', 'paused', 'cancelled', 'expired')),
	CONSTRAINT "recurring_mandates_reference_last4" CHECK (length("recurring_payment_mandates"."subscriber_reference_last4") = 4),
	CONSTRAINT "recurring_mandates_retries" CHECK ("recurring_payment_mandates"."retry_count" >= 0 AND "recurring_payment_mandates"."max_retries" BETWEEN 0 AND 10)
);
--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_biller_id_billers_id_fk" FOREIGN KEY ("biller_id") REFERENCES "public"."billers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_obligation_id_biller_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."biller_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_mandate_id_recurring_payment_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."recurring_payment_mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_orders" ADD CONSTRAINT "bill_payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biller_obligations" ADD CONSTRAINT "biller_obligations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biller_obligations" ADD CONSTRAINT "biller_obligations_biller_id_billers_id_fk" FOREIGN KEY ("biller_id") REFERENCES "public"."billers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biller_obligations" ADD CONSTRAINT "biller_obligations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billers" ADD CONSTRAINT "billers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billers" ADD CONSTRAINT "billers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_executions" ADD CONSTRAINT "recurring_payment_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_executions" ADD CONSTRAINT "recurring_payment_executions_mandate_id_recurring_payment_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."recurring_payment_mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_executions" ADD CONSTRAINT "recurring_payment_executions_order_id_bill_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bill_payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_mandates" ADD CONSTRAINT "recurring_payment_mandates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_mandates" ADD CONSTRAINT "recurring_payment_mandates_biller_id_billers_id_fk" FOREIGN KEY ("biller_id") REFERENCES "public"."billers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_mandates" ADD CONSTRAINT "recurring_payment_mandates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payment_mandates" ADD CONSTRAINT "recurring_payment_mandates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bill_payment_orders_org_idempotency" ON "bill_payment_orders" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bill_payment_orders_transaction" ON "bill_payment_orders" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bill_payment_orders_reversal" ON "bill_payment_orders" USING btree ("reversal_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bill_payment_orders_active_obligation" ON "bill_payment_orders" USING btree ("obligation_id") WHERE "bill_payment_orders"."obligation_id" IS NOT NULL AND "bill_payment_orders"."status" IN ('review', 'settled');--> statement-breakpoint
CREATE INDEX "idx_bill_payment_orders_org_status_created" ON "bill_payment_orders" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_bill_payment_orders_obligation" ON "bill_payment_orders" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "idx_bill_payment_orders_mandate" ON "bill_payment_orders" USING btree ("mandate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_biller_obligations_org_idempotency" ON "biller_obligations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_biller_obligations_external" ON "biller_obligations" USING btree ("organization_id","biller_id","external_reference");--> statement-breakpoint
CREATE INDEX "idx_biller_obligations_lookup" ON "biller_obligations" USING btree ("organization_id","biller_id","subscriber_reference_hash","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billers_org_code" ON "billers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_billers_org_idempotency" ON "billers" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_billers_org_status_country" ON "billers" USING btree ("organization_id","status","country");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recurring_executions_mandate_schedule_attempt" ON "recurring_payment_executions" USING btree ("mandate_id","scheduled_for","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_recurring_executions_org_attempted" ON "recurring_payment_executions" USING btree ("organization_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recurring_mandates_org_idempotency" ON "recurring_payment_mandates" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recurring_mandates_org_consent" ON "recurring_payment_mandates" USING btree ("organization_id","consent_reference");--> statement-breakpoint
CREATE INDEX "idx_recurring_mandates_due" ON "recurring_payment_mandates" USING btree ("status","next_charge_at");--> statement-breakpoint
CREATE INDEX "idx_recurring_mandates_org_account" ON "recurring_payment_mandates" USING btree ("organization_id","account_id","status");