CREATE TABLE "payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"external_reference" text NOT NULL,
	"allowed_methods" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" text NOT NULL,
	"paid_method" text,
	"payer_account_id" text,
	"transaction_id" text,
	"reversal_transaction_id" text,
	"pay_idempotency_key" text,
	"pay_fingerprint" text,
	"refund_idempotency_key" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "payment_links_currency" CHECK ("payment_links"."currency" = 'ARS'),
	CONSTRAINT "payment_links_status" CHECK ("payment_links"."status" IN ('open', 'pending', 'paid', 'expired', 'cancelled', 'refunded')),
	CONSTRAINT "payment_links_paid_method" CHECK ("payment_links"."paid_method" IS NULL OR "payment_links"."paid_method" IN ('internal', 'sandbox_inbound')),
	CONSTRAINT "payment_links_amount_positive" CHECK ("payment_links"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_org_idempotency" ON "payment_links" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_org_reference" ON "payment_links" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_payload" ON "payment_links" USING btree ("payload");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_transaction" ON "payment_links" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_reversal" ON "payment_links" USING btree ("reversal_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_org_pay_idempotency" ON "payment_links" USING btree ("organization_id","pay_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_org_refund_idempotency" ON "payment_links" USING btree ("organization_id","refund_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_payment_links_org_created" ON "payment_links" USING btree ("organization_id","created_at");