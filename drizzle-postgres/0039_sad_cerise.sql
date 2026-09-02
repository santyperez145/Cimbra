CREATE TABLE "qr_debts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"account_id" text NOT NULL,
	"payment_qr_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"external_reference" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" text NOT NULL,
	"paid_transfer_id" text,
	"cancel_idempotency_key" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "qr_debts_currency" CHECK ("qr_debts"."currency" = 'ARS'),
	CONSTRAINT "qr_debts_status" CHECK ("qr_debts"."status" IN ('open', 'paid', 'expired', 'cancelled')),
	CONSTRAINT "qr_debts_amount_positive" CHECK ("qr_debts"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_qrs" DROP CONSTRAINT "payment_qrs_kind";--> statement-breakpoint
ALTER TABLE "payment_qrs" DROP CONSTRAINT "payment_qrs_expires_shape";--> statement-breakpoint
ALTER TABLE "qr_debts" ADD CONSTRAINT "qr_debts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_debts" ADD CONSTRAINT "qr_debts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_debts" ADD CONSTRAINT "qr_debts_payment_qr_id_payment_qrs_id_fk" FOREIGN KEY ("payment_qr_id") REFERENCES "public"."payment_qrs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_debts" ADD CONSTRAINT "qr_debts_paid_transfer_id_instant_transfers_id_fk" FOREIGN KEY ("paid_transfer_id") REFERENCES "public"."instant_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_debts" ADD CONSTRAINT "qr_debts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_debts_org_idempotency" ON "qr_debts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_debts_org_reference" ON "qr_debts" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_debts_payment_qr" ON "qr_debts" USING btree ("payment_qr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_debts_org_cancel_idempotency" ON "qr_debts" USING btree ("organization_id","cancel_idempotency_key") WHERE "qr_debts"."cancel_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_qr_debts_org_created" ON "qr_debts" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_debt_closed" CHECK ("payment_qrs"."kind" <> 'debt' OR "payment_qrs"."amount_minor" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_kind" CHECK ("payment_qrs"."kind" IN ('dynamic', 'static', 'debt'));--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_expires_shape" CHECK (("payment_qrs"."kind" = 'static' AND "payment_qrs"."expires_at" IS NULL) OR ("payment_qrs"."kind" IN ('dynamic', 'debt') AND "payment_qrs"."expires_at" IS NOT NULL));