CREATE TABLE "payment_link_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"payment_link_id" text NOT NULL,
	"credit_id" text,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"transaction_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "payment_link_refunds_amount_positive" CHECK ("payment_link_refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "refunded_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "payment_links" SET "refunded_minor" = "collected_minor", "collected_minor" = 0 WHERE "status" = 'refunded' AND "collected_minor" > 0;--> statement-breakpoint
UPDATE "payment_link_credits" AS c SET "refunded_minor" = c."amount_minor" FROM "payment_links" AS pl WHERE pl."id" = c."payment_link_id" AND pl."status" = 'refunded';--> statement-breakpoint
ALTER TABLE "payment_link_refunds" ADD CONSTRAINT "payment_link_refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_refunds" ADD CONSTRAINT "payment_link_refunds_payment_link_id_payment_links_id_fk" FOREIGN KEY ("payment_link_id") REFERENCES "public"."payment_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_refunds" ADD CONSTRAINT "payment_link_refunds_credit_id_payment_link_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."payment_link_credits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_refunds" ADD CONSTRAINT "payment_link_refunds_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_link_refunds" ADD CONSTRAINT "payment_link_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_link_refunds_org_idempotency" ON "payment_link_refunds" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_link_refunds_transaction" ON "payment_link_refunds" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_payment_link_refunds_link_created" ON "payment_link_refunds" USING btree ("payment_link_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_link_credits" ADD CONSTRAINT "payment_link_credits_refunded_range" CHECK ("payment_link_credits"."refunded_minor" >= 0 AND "payment_link_credits"."refunded_minor" <= "payment_link_credits"."amount_minor");--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_refunded_nonnegative" CHECK ("payment_links"."refunded_minor" >= 0);