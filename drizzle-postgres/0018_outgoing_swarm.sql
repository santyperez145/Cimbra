CREATE TABLE "risk_list_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_hash" text NOT NULL,
	"subject_preview" text NOT NULL,
	"category" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"created_by" text NOT NULL,
	"disabled_by" text,
	"disabled_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "risk_list_entries_subject_type" CHECK ("risk_list_entries"."subject_type" IN ('counterparty', 'device', 'identity')),
	CONSTRAINT "risk_list_entries_category" CHECK ("risk_list_entries"."category" IN ('allow', 'watch', 'block')),
	CONSTRAINT "risk_list_entries_status" CHECK ("risk_list_entries"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "risk_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"evaluation_id" text NOT NULL,
	"supersedes_outcome_id" text,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"label" text NOT NULL,
	"fraud_type" text,
	"loss_amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reported_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "risk_outcomes_label" CHECK ("risk_outcomes"."label" IN ('legitimate', 'fraud')),
	CONSTRAINT "risk_outcomes_fraud_type" CHECK ("risk_outcomes"."fraud_type" IS NULL OR "risk_outcomes"."fraud_type" IN ('account_takeover', 'identity_fraud', 'scam', 'stolen_instrument', 'merchant_fraud', 'other')),
	CONSTRAINT "risk_outcomes_status" CHECK ("risk_outcomes"."status" IN ('active', 'superseded')),
	CONSTRAINT "risk_outcomes_loss" CHECK ("risk_outcomes"."loss_amount_minor" >= 0),
	CONSTRAINT "risk_outcomes_consistency" CHECK (("risk_outcomes"."label" = 'legitimate' AND "risk_outcomes"."fraud_type" IS NULL AND "risk_outcomes"."loss_amount_minor" = 0) OR ("risk_outcomes"."label" = 'fraud' AND "risk_outcomes"."fraud_type" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD COLUMN "matched_list_entry_ids" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD COLUMN "signals" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_list_entries" ADD CONSTRAINT "risk_list_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_list_entries" ADD CONSTRAINT "risk_list_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_list_entries" ADD CONSTRAINT "risk_list_entries_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_outcomes" ADD CONSTRAINT "risk_outcomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_outcomes" ADD CONSTRAINT "risk_outcomes_evaluation_id_risk_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."risk_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_outcomes" ADD CONSTRAINT "risk_outcomes_supersedes_outcome_id_risk_outcomes_id_fk" FOREIGN KEY ("supersedes_outcome_id") REFERENCES "public"."risk_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_outcomes" ADD CONSTRAINT "risk_outcomes_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_list_entries_org_idempotency" ON "risk_list_entries" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_list_entries_one_active_subject" ON "risk_list_entries" USING btree ("organization_id","subject_type","subject_hash") WHERE "risk_list_entries"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_risk_list_entries_org_status_expiry" ON "risk_list_entries" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_outcomes_org_idempotency" ON "risk_outcomes" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_outcomes_one_active_evaluation" ON "risk_outcomes" USING btree ("organization_id","evaluation_id") WHERE "risk_outcomes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_risk_outcomes_org_created" ON "risk_outcomes" USING btree ("organization_id","created_at");