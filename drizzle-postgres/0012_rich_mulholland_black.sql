CREATE TABLE "approval_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"action_type" text NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"expires_in_minutes" integer DEFAULT 1440 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "approval_policies_action" CHECK ("approval_policies"."action_type" IN ('settlement.execute')),
	CONSTRAINT "approval_policies_enabled" CHECK ("approval_policies"."enabled" IN (0, 1)),
	CONSTRAINT "approval_policies_expiry" CHECK ("approval_policies"."expires_in_minutes" BETWEEN 15 AND 10080)
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"action_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_payload" text DEFAULT '{}' NOT NULL,
	"requested_by" text NOT NULL,
	"resolved_by" text,
	"resolution_reason" text,
	"expires_at" text NOT NULL,
	"resolved_at" text,
	"executed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "approval_requests_action" CHECK ("approval_requests"."action_type" IN ('settlement.execute')),
	CONSTRAINT "approval_requests_resource" CHECK ("approval_requests"."resource_type" IN ('settlement_cycle')),
	CONSTRAINT "approval_requests_status" CHECK ("approval_requests"."status" IN ('pending', 'executed', 'rejected', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_approval_policies_org_action" ON "approval_policies" USING btree ("organization_id","action_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_approval_requests_org_idempotency" ON "approval_requests" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_org_status" ON "approval_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_org_resource" ON "approval_requests" USING btree ("organization_id","action_type","resource_id");