CREATE TABLE "reconciliation_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"difference_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolution_note" text,
	"resolution_idempotency_key" text,
	"resolved_by" text,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "reconciliation_exceptions_kind" CHECK ("reconciliation_exceptions"."kind" IN ('amount_mismatch', 'missing_internal', 'missing_external')),
	CONSTRAINT "reconciliation_exceptions_status" CHECK ("reconciliation_exceptions"."status" IN ('open', 'resolved', 'accepted')),
	CONSTRAINT "reconciliation_exceptions_resolution" CHECK ("reconciliation_exceptions"."resolution" IS NULL OR "reconciliation_exceptions"."resolution" IN ('corrected', 'accepted'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"transaction_id" text,
	"external_reference" text NOT NULL,
	"expected_minor" bigint NOT NULL,
	"actual_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	CONSTRAINT "reconciliation_items_status" CHECK ("reconciliation_items"."status" IN ('matched', 'mismatch', 'missing_internal', 'missing_external', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"currency" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expected_minor" bigint DEFAULT 0 NOT NULL,
	"actual_minor" bigint DEFAULT 0 NOT NULL,
	"difference_minor" bigint DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "reconciliation_runs_source" CHECK ("reconciliation_runs"."source" IN ('bank', 'clearing', 'card_network', 'cash_network', 'internal')),
	CONSTRAINT "reconciliation_runs_status" CHECK ("reconciliation_runs"."status" IN ('open', 'completed')),
	CONSTRAINT "reconciliation_runs_counts" CHECK ("reconciliation_runs"."matched_count" >= 0 AND "reconciliation_runs"."exception_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "risk_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"evaluation_id" text NOT NULL,
	"transaction_id" text,
	"hold_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"resolution" text,
	"resolution_note" text,
	"resolution_idempotency_key" text,
	"resolved_by" text,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "risk_cases_status" CHECK ("risk_cases"."status" IN ('open', 'resolved')),
	CONSTRAINT "risk_cases_priority" CHECK ("risk_cases"."priority" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "risk_cases_resolution" CHECK ("risk_cases"."resolution" IS NULL OR "risk_cases"."resolution" IN ('approved', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "risk_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"operation_type" text NOT NULL,
	"resource_type" text DEFAULT 'transaction' NOT NULL,
	"resource_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"counterparty" text NOT NULL,
	"score" integer NOT NULL,
	"decision" text NOT NULL,
	"matched_rule_ids" text DEFAULT '[]' NOT NULL,
	"reasons" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "risk_evaluations_operation" CHECK ("risk_evaluations"."operation_type" IN ('transfer', 'cash_in', 'cash_out')),
	CONSTRAINT "risk_evaluations_score" CHECK ("risk_evaluations"."score" BETWEEN 0 AND 100),
	CONSTRAINT "risk_evaluations_decision" CHECK ("risk_evaluations"."decision" IN ('approve', 'review', 'decline'))
);
--> statement-breakpoint
CREATE TABLE "risk_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"operation_type" text DEFAULT 'any' NOT NULL,
	"score_delta" integer NOT NULL,
	"action" text NOT NULL,
	"configuration" text DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "risk_rules_kind" CHECK ("risk_rules"."kind" IN ('amount_threshold', 'velocity_count', 'counterparty_match')),
	CONSTRAINT "risk_rules_operation" CHECK ("risk_rules"."operation_type" IN ('any', 'transfer', 'cash_in', 'cash_out')),
	CONSTRAINT "risk_rules_score" CHECK ("risk_rules"."score_delta" BETWEEN 0 AND 100),
	CONSTRAINT "risk_rules_action" CHECK ("risk_rules"."action" IN ('score', 'review', 'decline')),
	CONSTRAINT "risk_rules_priority" CHECK ("risk_rules"."priority" BETWEEN 1 AND 1000),
	CONSTRAINT "risk_rules_status" CHECK ("risk_rules"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_item_id_reconciliation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."reconciliation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_evaluation_id_risk_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."risk_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reconciliation_exceptions_item" ON "reconciliation_exceptions" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reconciliation_exceptions_org_resolution_idempotency" ON "reconciliation_exceptions" USING btree ("organization_id","resolution_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_reconciliation_exceptions_org_status_created" ON "reconciliation_exceptions" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_reconciliation_items_run" ON "reconciliation_items" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reconciliation_items_run_external" ON "reconciliation_items" USING btree ("run_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reconciliation_runs_org_idempotency" ON "reconciliation_runs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_reconciliation_runs_org_created" ON "reconciliation_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_cases_evaluation" ON "risk_cases" USING btree ("evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_cases_org_resolution_idempotency" ON "risk_cases" USING btree ("organization_id","resolution_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_cases_org_status_created" ON "risk_cases" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_evaluations_org_idempotency" ON "risk_evaluations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_evaluations_org_created" ON "risk_evaluations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_risk_evaluations_resource" ON "risk_evaluations" USING btree ("organization_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_rules_org_idempotency" ON "risk_rules" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_rules_org_status_priority" ON "risk_rules" USING btree ("organization_id","status","priority");