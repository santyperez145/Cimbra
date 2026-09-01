CREATE TABLE "wallet_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "wallet_lifecycle_from_status" CHECK ("wallet_lifecycle_events"."from_status" IS NULL OR "wallet_lifecycle_events"."from_status" IN ('active', 'frozen', 'closed')),
	CONSTRAINT "wallet_lifecycle_to_status" CHECK ("wallet_lifecycle_events"."to_status" IN ('active', 'frozen', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "wallet_pockets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "wallet_pockets_kind" CHECK ("wallet_pockets"."kind" IN ('available', 'pending', 'rewards'))
);
--> statement-breakpoint
CREATE TABLE "wallet_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"support_url" text,
	"terms_url" text,
	"accent_color" text,
	"default_currency" text NOT NULL,
	"allowed_currencies" text NOT NULL,
	"pocket_kinds" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "wallet_programs_status" CHECK ("wallet_programs"."status" IN ('active', 'inactive')),
	CONSTRAINT "wallet_programs_currency" CHECK ("wallet_programs"."default_currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN'))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"program_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"external_reference" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "wallets_status" CHECK ("wallets"."status" IN ('active', 'frozen', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "wallet_lifecycle_events" ADD CONSTRAINT "wallet_lifecycle_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lifecycle_events" ADD CONSTRAINT "wallet_lifecycle_events_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lifecycle_events" ADD CONSTRAINT "wallet_lifecycle_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_pockets" ADD CONSTRAINT "wallet_pockets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_pockets" ADD CONSTRAINT "wallet_pockets_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_pockets" ADD CONSTRAINT "wallet_pockets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_program_id_wallet_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."wallet_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_lifecycle_org_idempotency" ON "wallet_lifecycle_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_wallet_lifecycle_wallet_created" ON "wallet_lifecycle_events" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_pockets_wallet_kind" ON "wallet_pockets" USING btree ("wallet_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_pockets_account" ON "wallet_pockets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_wallet_pockets_org_wallet" ON "wallet_pockets" USING btree ("organization_id","wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_programs_org_idempotency" ON "wallet_programs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallet_programs_org_name" ON "wallet_programs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_wallet_programs_org_created" ON "wallet_programs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallets_org_idempotency" ON "wallets" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallets_org_reference" ON "wallets" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallets_org_program_customer" ON "wallets" USING btree ("organization_id","program_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_wallets_org_created" ON "wallets" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_wallets_customer" ON "wallets" USING btree ("customer_id");