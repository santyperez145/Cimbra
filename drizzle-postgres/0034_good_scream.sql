ALTER TABLE "rail_instruments" ADD COLUMN "assign_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "rail_instruments" ADD COLUMN "value_changed_at" text;--> statement-breakpoint
ALTER TABLE "rail_instruments" ADD COLUMN "updated_at" text;--> statement-breakpoint
UPDATE "rail_instruments" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "rail_instruments" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rail_instruments_org_assign_idempotency" ON "rail_instruments" USING btree ("organization_id","assign_idempotency_key") WHERE "rail_instruments"."assign_idempotency_key" IS NOT NULL;
