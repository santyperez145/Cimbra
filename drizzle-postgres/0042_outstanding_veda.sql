CREATE TABLE "payment_link_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"payment_link_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"payer_account_id" text,
	"transaction_id" text NOT NULL,
	"instant_transfer_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "payment_link_credits_method" CHECK ("payment_link_credits"."method" = 'cimbra_cvu'),
	CONSTRAINT "payment_link_credits_amount_positive" CHECK ("payment_link_credits"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "collected_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "payment_links" SET "collected_minor" = "amount_minor" WHERE "status" IN ('paid', 'pending', 'refunded');--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_payment_link_id_payment_links_id_fk" FOREIGN KEY ("payment_link_id") REFERENCES "public"."payment_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_instant_transfer_id_instant_transfers_id_fk" FOREIGN KEY ("instant_transfer_id") REFERENCES "public"."instant_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_link_credits_org_idempotency" ON "payment_link_credits" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_link_credits_transaction" ON "payment_link_credits" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_link_credits_transfer" ON "payment_link_credits" USING btree ("instant_transfer_id") WHERE "payment_link_credits"."instant_transfer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payment_link_credits_link_created" ON "payment_link_credits" USING btree ("payment_link_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_collected_nonnegative" CHECK ("payment_links"."collected_minor" >= 0);