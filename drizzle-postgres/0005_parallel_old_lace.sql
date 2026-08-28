ALTER TABLE "accounts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_accounts_org_idempotency" ON "accounts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cards_org_idempotency" ON "cards" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_org_idempotency" ON "customers" USING btree ("organization_id","idempotency_key");