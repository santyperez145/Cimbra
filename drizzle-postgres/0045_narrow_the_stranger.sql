DROP INDEX "idx_payment_qrs_account_active_static";--> statement-breakpoint
ALTER TABLE "collection_tills" ADD COLUMN "presence" text DEFAULT 'not_present' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD COLUMN "closed_amount_only" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD COLUMN "qr_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD COLUMN "owner" text DEFAULT 'account' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_qr_idempotency" ON "collection_tills" USING btree ("organization_id","qr_idempotency_key") WHERE "collection_tills"."qr_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_qrs_account_active_static" ON "payment_qrs" USING btree ("account_id") WHERE "payment_qrs"."kind" = 'static' AND "payment_qrs"."status" = 'active' AND "payment_qrs"."owner" = 'account';--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_presence" CHECK ("collection_tills"."presence" IN ('present', 'not_present'));--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_closed_amount" CHECK ("collection_tills"."closed_amount_only" IN (0, 1));--> statement-breakpoint
ALTER TABLE "payment_qrs" ADD CONSTRAINT "payment_qrs_owner" CHECK ("payment_qrs"."owner" IN ('account', 'till'));