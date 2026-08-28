CREATE TABLE "settlement_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reconciliation_run_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"rail" text NOT NULL,
	"currency" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"difference_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"scheduled_for" text,
	"execution_idempotency_key" text,
	"created_by" text NOT NULL,
	"settled_by" text,
	"settled_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "settlement_cycles_rail" CHECK ("settlement_cycles"."rail" IN ('bank', 'clearing', 'card_network', 'cash_network', 'internal')),
	CONSTRAINT "settlement_cycles_status" CHECK ("settlement_cycles"."status" IN ('ready', 'scheduled', 'settled'))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "ingestion_mode" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "file_sha256" text;--> statement-breakpoint
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_reconciliation_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("reconciliation_run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_cycles" ADD CONSTRAINT "settlement_cycles_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settlement_cycles_run" ON "settlement_cycles" USING btree ("reconciliation_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settlement_cycles_org_idempotency" ON "settlement_cycles" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_settlement_cycles_org_execution_idempotency" ON "settlement_cycles" USING btree ("organization_id","execution_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_settlement_cycles_org_status_schedule" ON "settlement_cycles" USING btree ("organization_id","status","scheduled_for");--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_ingestion" CHECK ("reconciliation_runs"."ingestion_mode" IN ('api', 'csv'));