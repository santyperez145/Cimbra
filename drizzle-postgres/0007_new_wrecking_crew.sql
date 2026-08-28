CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"capabilities" text DEFAULT '[]' NOT NULL,
	"transport" text NOT NULL,
	"credential_ref_ciphertext" text NOT NULL,
	"configuration" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending_validation' NOT NULL,
	"created_by" text NOT NULL,
	"last_checked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "provider_connections_provider" CHECK ("provider_connections"."provider" IN ('bindx', 'dock', 'tapi', 'pismo', 'pomelo', 'wibond')),
	CONSTRAINT "provider_connections_environment" CHECK ("provider_connections"."environment" IN ('sandbox', 'production')),
	CONSTRAINT "provider_connections_transport" CHECK ("provider_connections"."transport" IN ('rest_api', 'webhook', 'batch_file', 'sftp', 'vpn', 'iso8583')),
	CONSTRAINT "provider_connections_status" CHECK ("provider_connections"."status" IN ('pending_validation', 'active', 'degraded', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_connections_org_idempotency" ON "provider_connections" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_connections_org_name" ON "provider_connections" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_provider_connections_org_created" ON "provider_connections" USING btree ("organization_id","created_at");