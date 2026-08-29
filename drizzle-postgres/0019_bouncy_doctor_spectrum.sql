CREATE TABLE "card_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"card_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"version" integer NOT NULL,
	"currency" text NOT NULL,
	"per_transaction_limit_minor" bigint,
	"daily_limit_minor" bigint,
	"monthly_limit_minor" bigint,
	"allowed_channels" text NOT NULL,
	"allowed_mccs" text DEFAULT '[]' NOT NULL,
	"blocked_mccs" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "card_controls_version" CHECK ("card_controls"."version" > 0),
	CONSTRAINT "card_controls_status" CHECK ("card_controls"."status" IN ('active', 'inactive')),
	CONSTRAINT "card_controls_currency" CHECK ("card_controls"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN')),
	CONSTRAINT "card_controls_limits_positive" CHECK (("card_controls"."per_transaction_limit_minor" IS NULL OR "card_controls"."per_transaction_limit_minor" > 0) AND ("card_controls"."daily_limit_minor" IS NULL OR "card_controls"."daily_limit_minor" > 0) AND ("card_controls"."monthly_limit_minor" IS NULL OR "card_controls"."monthly_limit_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "card_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"card_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "card_lifecycle_from_status" CHECK ("card_lifecycle_events"."from_status" IS NULL OR "card_lifecycle_events"."from_status" IN ('created', 'active', 'frozen', 'terminated')),
	CONSTRAINT "card_lifecycle_to_status" CHECK ("card_lifecycle_events"."to_status" IN ('created', 'active', 'frozen', 'terminated'))
);
--> statement-breakpoint
CREATE TABLE "card_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"product" text NOT NULL,
	"formats" text NOT NULL,
	"default_currency" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "card_programs_product" CHECK ("card_programs"."product" IN ('debit', 'credit', 'prepaid')),
	CONSTRAINT "card_programs_status" CHECK ("card_programs"."status" IN ('active', 'inactive')),
	CONSTRAINT "card_programs_currency" CHECK ("card_programs"."default_currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN'))
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "program_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "activated_at" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "terminated_at" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "card_controls" ADD CONSTRAINT "card_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_controls" ADD CONSTRAINT "card_controls_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_controls" ADD CONSTRAINT "card_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_lifecycle_events" ADD CONSTRAINT "card_lifecycle_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_lifecycle_events" ADD CONSTRAINT "card_lifecycle_events_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_lifecycle_events" ADD CONSTRAINT "card_lifecycle_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_programs" ADD CONSTRAINT "card_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_programs" ADD CONSTRAINT "card_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_controls_org_idempotency" ON "card_controls" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_controls_card_version" ON "card_controls" USING btree ("card_id","version");--> statement-breakpoint
CREATE INDEX "idx_card_controls_org_created" ON "card_controls" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_lifecycle_org_idempotency" ON "card_lifecycle_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_card_lifecycle_card_created" ON "card_lifecycle_events" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_programs_org_idempotency" ON "card_programs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_programs_org_name" ON "card_programs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_card_programs_org_created" ON "card_programs" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_program_id_card_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."card_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cards_program" ON "cards" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_status" CHECK ("cards"."status" IN ('created', 'active', 'frozen', 'terminated'));--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_format" CHECK ("cards"."format" IN ('virtual', 'physical'));--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_product" CHECK ("cards"."product" IN ('debit', 'credit', 'prepaid'));