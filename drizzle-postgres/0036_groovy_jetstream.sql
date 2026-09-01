ALTER TABLE "payment_qrs" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD COLUMN "kind" text DEFAULT 'dynamic' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD COLUMN "cancel_idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_qrs_account_active_static" ON "payment_qrs" USING btree ("account_id") WHERE "payment_qrs"."kind" = 'static' AND "payment_qrs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_qrs_org_cancel_idempotency" ON "payment_qrs" USING btree ("organization_id","cancel_idempotency_key") WHERE "payment_qrs"."cancel_idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_kind" CHECK ("payment_qrs"."kind" IN ('dynamic', 'static'));--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_static_open" CHECK ("payment_qrs"."kind" <> 'static' OR "payment_qrs"."amount_minor" IS NULL);--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_expires_shape" CHECK (("payment_qrs"."kind" = 'static' AND "payment_qrs"."expires_at" IS NULL) OR ("payment_qrs"."kind" = 'dynamic' AND "payment_qrs"."expires_at" IS NOT NULL));