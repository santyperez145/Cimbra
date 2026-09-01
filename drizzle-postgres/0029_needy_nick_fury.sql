CREATE TABLE "instant_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"scheme" text NOT NULL,
	"direction" text NOT NULL,
	"source_account_id" text,
	"destination_account_id" text,
	"counterparty_kind" text NOT NULL,
	"counterparty_hash" text NOT NULL,
	"counterparty_last4" text NOT NULL,
	"counterparty_holder_name" text,
	"counterparty_tax_last4" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"external_reference" text NOT NULL,
	"status" text NOT NULL,
	"rail" text DEFAULT 'cimbra_sandbox' NOT NULL,
	"transaction_id" text,
	"reversal_transaction_id" text,
	"qr_payload" text,
	"expires_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "instant_transfers_scheme" CHECK ("instant_transfers"."scheme" IN ('credit_push', 'debit_pull', 'qr_collect')),
	CONSTRAINT "instant_transfers_direction" CHECK ("instant_transfers"."direction" IN ('outbound', 'inbound', 'internal')),
	CONSTRAINT "instant_transfers_counterparty_kind" CHECK ("instant_transfers"."counterparty_kind" IN ('cvu', 'cbu', 'alias')),
	CONSTRAINT "instant_transfers_status" CHECK ("instant_transfers"."status" IN ('pending', 'accepted', 'rejected', 'settled', 'returned', 'expired', 'cancelled')),
	CONSTRAINT "instant_transfers_currency" CHECK ("instant_transfers"."currency" = 'ARS'),
	CONSTRAINT "instant_transfers_amount_positive" CHECK ("instant_transfers"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_qrs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_minor" bigint,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text NOT NULL,
	"paid_transfer_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "payment_qrs_currency" CHECK ("payment_qrs"."currency" = 'ARS'),
	CONSTRAINT "payment_qrs_status" CHECK ("payment_qrs"."status" IN ('active', 'paid', 'expired', 'cancelled')),
	CONSTRAINT "payment_qrs_amount_positive" CHECK ("payment_qrs"."amount_minor" IS NULL OR "payment_qrs"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "rail_instruments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"holder_name" text NOT NULL,
	"tax_id_last4" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "rail_instruments_kind" CHECK ("rail_instruments"."kind" IN ('cvu', 'alias')),
	CONSTRAINT "rail_instruments_status" CHECK ("rail_instruments"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_paid_transfer_id_instant_transfers_id_fk" FOREIGN KEY ("paid_transfer_id") REFERENCES "public"."instant_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_instruments" ADD CONSTRAINT "rail_instruments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_instruments" ADD CONSTRAINT "rail_instruments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_instruments" ADD CONSTRAINT "rail_instruments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instant_transfers_org_idempotency" ON "instant_transfers" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instant_transfers_org_reference" ON "instant_transfers" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instant_transfers_transaction" ON "instant_transfers" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_instant_transfers_reversal" ON "instant_transfers" USING btree ("reversal_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_instant_transfers_org_created" ON "instant_transfers" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_instant_transfers_org_scheme" ON "instant_transfers" USING btree ("organization_id","scheme","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_qrs_org_idempotency" ON "payment_qrs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_qrs_payload" ON "payment_qrs" USING btree ("payload");--> statement-breakpoint
CREATE INDEX "idx_payment_qrs_org_created" ON "payment_qrs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rail_instruments_org_idempotency" ON "rail_instruments" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rail_instruments_org_value" ON "rail_instruments" USING btree ("organization_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rail_instruments_account_kind" ON "rail_instruments" USING btree ("account_id","kind");--> statement-breakpoint
CREATE INDEX "idx_rail_instruments_org_created" ON "rail_instruments" USING btree ("organization_id","created_at");