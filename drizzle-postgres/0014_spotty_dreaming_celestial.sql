CREATE TABLE "operational_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "operational_actions_subject" CHECK ("operational_actions"."subject_type" IN ('risk_case', 'reconciliation_exception')),
	CONSTRAINT "operational_actions_action" CHECK ("operational_actions"."action" IN ('update', 'note', 'evidence'))
);
--> statement-breakpoint
CREATE TABLE "operational_evidence_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"document_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"action_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "operational_evidence_subject" CHECK ("operational_evidence_links"."subject_type" IN ('risk_case', 'reconciliation_exception'))
);
--> statement-breakpoint
CREATE TABLE "operational_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"action_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "operational_notes_subject" CHECK ("operational_notes"."subject_type" IN ('risk_case', 'reconciliation_exception'))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN "due_at" text;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD COLUMN "escalated_at" text;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD COLUMN "due_at" text;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD COLUMN "escalated_at" text;--> statement-breakpoint
UPDATE "risk_cases" SET "due_at" = (("created_at"::timestamptz + CASE "priority" WHEN 'critical' THEN interval '1 hour' WHEN 'high' THEN interval '4 hours' WHEN 'low' THEN interval '72 hours' ELSE interval '24 hours' END))::text WHERE "status" = 'open' AND "due_at" IS NULL;--> statement-breakpoint
UPDATE "reconciliation_exceptions" SET "due_at" = (("created_at"::timestamptz + interval '24 hours'))::text WHERE "status" = 'open' AND "due_at" IS NULL;--> statement-breakpoint
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_evidence_links" ADD CONSTRAINT "operational_evidence_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_evidence_links" ADD CONSTRAINT "operational_evidence_links_document_id_compliance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."compliance_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_evidence_links" ADD CONSTRAINT "operational_evidence_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_evidence_links" ADD CONSTRAINT "operational_evidence_links_action_id_operational_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."operational_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_notes" ADD CONSTRAINT "operational_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_notes" ADD CONSTRAINT "operational_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_notes" ADD CONSTRAINT "operational_notes_action_id_operational_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."operational_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_operational_actions_org_idempotency" ON "operational_actions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_operational_actions_subject" ON "operational_actions" USING btree ("organization_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_operational_evidence_action" ON "operational_evidence_links" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_operational_evidence_subject_document" ON "operational_evidence_links" USING btree ("organization_id","subject_type","subject_id","document_id");--> statement-breakpoint
CREATE INDEX "idx_operational_evidence_subject" ON "operational_evidence_links" USING btree ("organization_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_operational_notes_action" ON "operational_notes" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "idx_operational_notes_subject" ON "operational_notes" USING btree ("organization_id","subject_type","subject_id","created_at");--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cases" ADD CONSTRAINT "risk_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_priority" CHECK ("reconciliation_exceptions"."priority" IN ('low', 'medium', 'high', 'critical'));
