CREATE TABLE "dispute_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dispute_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "dispute_events_event" CHECK ("dispute_events"."event" IN ('created', 'start_review', 'mark_network_ready', 'resolve_won', 'resolve_lost', 'reject', 'cancel'))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'opened' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"provisional_credit_requested" integer DEFAULT 0 NOT NULL,
	"credit_status" text DEFAULT 'none' NOT NULL,
	"credit_transaction_id" text,
	"credit_reversal_transaction_id" text,
	"assigned_to" text,
	"due_at" text,
	"escalated_at" text,
	"opened_by" text NOT NULL,
	"resolved_by" text,
	"resolution_note" text,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "disputes_reason" CHECK ("disputes"."reason" IN ('card_not_present', 'duplicate', 'amount_mismatch', 'service_not_received', 'credit_not_processed', 'cash_not_received', 'other')),
	CONSTRAINT "disputes_status" CHECK ("disputes"."status" IN ('opened', 'under_review', 'network_ready', 'won', 'lost', 'rejected', 'cancelled')),
	CONSTRAINT "disputes_priority" CHECK ("disputes"."priority" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "disputes_amount_positive" CHECK ("disputes"."amount_minor" > 0),
	CONSTRAINT "disputes_provisional_credit" CHECK ("disputes"."provisional_credit_requested" IN (0, 1)),
	CONSTRAINT "disputes_credit_status" CHECK ("disputes"."credit_status" IN ('none', 'posted', 'final', 'reversed'))
);
--> statement-breakpoint
ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_action";--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_action_resource";--> statement-breakpoint
ALTER TABLE "operational_actions" DROP CONSTRAINT "operational_actions_subject";--> statement-breakpoint
ALTER TABLE "operational_evidence_links" DROP CONSTRAINT "operational_evidence_subject";--> statement-breakpoint
ALTER TABLE "operational_notes" DROP CONSTRAINT "operational_notes_subject";--> statement-breakpoint
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_credit_transaction_id_transactions_id_fk" FOREIGN KEY ("credit_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_credit_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("credit_reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dispute_events_org_idempotency" ON "dispute_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_dispute_events_dispute_created" ON "dispute_events" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_disputes_org_idempotency" ON "disputes" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_disputes_org_transaction" ON "disputes" USING btree ("organization_id","transaction_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_org_status_created" ON "disputes" USING btree ("organization_id","status","created_at");--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_action" CHECK ("approval_policies"."action_type" IN ('settlement.execute', 'transfer.create', 'risk.case.resolve', 'reconciliation.exception.resolve', 'dispute.resolve'));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_resource" CHECK ((
    ("approval_requests"."action_type" = 'settlement.execute' AND "approval_requests"."resource_type" = 'settlement_cycle') OR
    ("approval_requests"."action_type" = 'transfer.create' AND "approval_requests"."resource_type" = 'transfer') OR
    ("approval_requests"."action_type" = 'risk.case.resolve' AND "approval_requests"."resource_type" = 'risk_case') OR
    ("approval_requests"."action_type" = 'reconciliation.exception.resolve' AND "approval_requests"."resource_type" = 'reconciliation_exception') OR
    ("approval_requests"."action_type" = 'dispute.resolve' AND "approval_requests"."resource_type" = 'dispute')
  ));--> statement-breakpoint
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_subject" CHECK ("operational_actions"."subject_type" IN ('risk_case', 'reconciliation_exception', 'dispute'));--> statement-breakpoint
ALTER TABLE "operational_evidence_links" ADD CONSTRAINT "operational_evidence_subject" CHECK ("operational_evidence_links"."subject_type" IN ('risk_case', 'reconciliation_exception', 'dispute'));--> statement-breakpoint
ALTER TABLE "operational_notes" ADD CONSTRAINT "operational_notes_subject" CHECK ("operational_notes"."subject_type" IN ('risk_case', 'reconciliation_exception', 'dispute'));