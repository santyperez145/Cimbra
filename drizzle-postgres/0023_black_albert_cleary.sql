CREATE TABLE "due_diligence_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"policy_version" text NOT NULL,
	"required_checks" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"risk_rating" text DEFAULT 'unassessed' NOT NULL,
	"expires_at" text NOT NULL,
	"created_by" text NOT NULL,
	"submitted_by" text,
	"submitted_at" text,
	"resolved_by" text,
	"resolution_note" text,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "due_diligence_cases_kind" CHECK ("due_diligence_cases"."kind" IN ('kyc', 'kyb')),
	CONSTRAINT "due_diligence_cases_status" CHECK ("due_diligence_cases"."status" IN ('draft', 'in_review', 'approved', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "due_diligence_cases_risk" CHECK ("due_diligence_cases"."risk_rating" IN ('unassessed', 'low', 'medium', 'high', 'prohibited'))
);
--> statement-breakpoint
CREATE TABLE "due_diligence_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"check_type" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"result_code" text NOT NULL,
	"note" text NOT NULL,
	"evidence_document_id" text,
	"checked_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "due_diligence_checks_type" CHECK ("due_diligence_checks"."check_type" IN ('identity_document', 'address', 'sanctions', 'pep', 'business_registry', 'beneficial_ownership')),
	CONSTRAINT "due_diligence_checks_source" CHECK ("due_diligence_checks"."source" IN ('manual_review', 'official_registry', 'internal_list')),
	CONSTRAINT "due_diligence_checks_status" CHECK ("due_diligence_checks"."status" IN ('pending', 'passed', 'failed', 'review'))
);
--> statement-breakpoint
CREATE TABLE "due_diligence_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "due_diligence_events_event" CHECK ("due_diligence_events"."event" IN ('created', 'submitted', 'approved', 'rejected', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "due_diligence_parties" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"tax_id_last4" text NOT NULL,
	"ownership_bps" integer,
	"pep_declared" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "due_diligence_parties_role" CHECK ("due_diligence_parties"."role" IN ('subject', 'legal_representative', 'beneficial_owner', 'director')),
	CONSTRAINT "due_diligence_parties_tax_last4" CHECK (length("due_diligence_parties"."tax_id_last4") = 4),
	CONSTRAINT "due_diligence_parties_ownership" CHECK ("due_diligence_parties"."ownership_bps" IS NULL OR "due_diligence_parties"."ownership_bps" BETWEEN 1 AND 10000),
	CONSTRAINT "due_diligence_parties_pep" CHECK ("due_diligence_parties"."pep_declared" IN (0, 1))
);
--> statement-breakpoint
ALTER TABLE "due_diligence_cases" ADD CONSTRAINT "due_diligence_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_cases" ADD CONSTRAINT "due_diligence_cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_cases" ADD CONSTRAINT "due_diligence_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_cases" ADD CONSTRAINT "due_diligence_cases_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_cases" ADD CONSTRAINT "due_diligence_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checks" ADD CONSTRAINT "due_diligence_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checks" ADD CONSTRAINT "due_diligence_checks_case_id_due_diligence_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."due_diligence_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checks" ADD CONSTRAINT "due_diligence_checks_evidence_document_id_compliance_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."compliance_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checks" ADD CONSTRAINT "due_diligence_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_events" ADD CONSTRAINT "due_diligence_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_events" ADD CONSTRAINT "due_diligence_events_case_id_due_diligence_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."due_diligence_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_events" ADD CONSTRAINT "due_diligence_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_parties" ADD CONSTRAINT "due_diligence_parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_parties" ADD CONSTRAINT "due_diligence_parties_case_id_due_diligence_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."due_diligence_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_parties" ADD CONSTRAINT "due_diligence_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_due_diligence_cases_org_idempotency" ON "due_diligence_cases" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_due_diligence_cases_customer_active" ON "due_diligence_cases" USING btree ("organization_id","customer_id") WHERE "due_diligence_cases"."status" IN ('draft', 'in_review');--> statement-breakpoint
CREATE INDEX "idx_due_diligence_cases_org_status_created" ON "due_diligence_cases" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_due_diligence_checks_org_idempotency" ON "due_diligence_checks" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_due_diligence_checks_case_type_created" ON "due_diligence_checks" USING btree ("case_id","check_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_due_diligence_events_org_idempotency" ON "due_diligence_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_due_diligence_events_case_created" ON "due_diligence_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_due_diligence_parties_org_idempotency" ON "due_diligence_parties" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_due_diligence_parties_case_created" ON "due_diligence_parties" USING btree ("case_id","created_at");