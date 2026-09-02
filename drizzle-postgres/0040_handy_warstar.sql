CREATE TABLE "collection_tills" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"account_id" text NOT NULL,
	"payment_qr_id" text,
	"name" text NOT NULL,
	"external_reference" text NOT NULL,
	"cvu" text NOT NULL,
	"alias" text,
	"alias_changed_at" text,
	"status" text DEFAULT 'active' NOT NULL,
	"assign_idempotency_key" text,
	"cancel_idempotency_key" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "collection_tills_status" CHECK ("collection_tills"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD COLUMN "collection_till_id" text;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_payment_qr_id_payment_qrs_id_fk" FOREIGN KEY ("payment_qr_id") REFERENCES "public"."payment_qrs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tills" ADD CONSTRAINT "collection_tills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_idempotency" ON "collection_tills" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_reference" ON "collection_tills" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_cvu" ON "collection_tills" USING btree ("cvu");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_alias" ON "collection_tills" USING btree ("organization_id","alias") WHERE "collection_tills"."alias" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_payment_qr" ON "collection_tills" USING btree ("payment_qr_id") WHERE "collection_tills"."payment_qr_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_assign_idempotency" ON "collection_tills" USING btree ("organization_id","assign_idempotency_key") WHERE "collection_tills"."assign_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_collection_tills_org_cancel_idempotency" ON "collection_tills" USING btree ("organization_id","cancel_idempotency_key") WHERE "collection_tills"."cancel_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_collection_tills_org_created" ON "collection_tills" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "instant_transfers" ADD CONSTRAINT "instant_transfers_collection_till_id_collection_tills_id_fk" FOREIGN KEY ("collection_till_id") REFERENCES "public"."collection_tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_instant_transfers_collection_till" ON "instant_transfers" USING btree ("collection_till_id");