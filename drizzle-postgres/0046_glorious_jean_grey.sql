CREATE TABLE "platform_operators" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "platform_operators_role" CHECK ("platform_operators"."role" IN ('owner', 'operator', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text,
	"opened_by" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "support_cases_category" CHECK ("support_cases"."category" IN ('sandbox', 'api', 'console', 'compliance', 'commercial', 'other')),
	CONSTRAINT "support_cases_status" CHECK ("support_cases"."status" IN ('open', 'pending_cimbra', 'pending_tenant', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text,
	"author_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "support_messages_author_kind" CHECK ("support_messages"."author_kind" IN ('tenant', 'platform'))
);
--> statement-breakpoint
ALTER TABLE "platform_operators" ADD CONSTRAINT "platform_operators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_support_cases_org_idempotency" ON "support_cases" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_support_cases_org_updated" ON "support_cases" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_support_cases_status" ON "support_cases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_support_messages_org_idempotency" ON "support_messages" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_support_messages_case_created" ON "support_messages" USING btree ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status" CHECK ("leads"."status" IN ('new', 'contacted', 'qualified', 'closed'));