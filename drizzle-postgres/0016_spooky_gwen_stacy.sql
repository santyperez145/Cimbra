CREATE TABLE "risk_rule_promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"previous_champion_id" text,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"promoted_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_simulations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_rule_id" text NOT NULL,
	"baseline_rule_id" text,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"sample_count" integer NOT NULL,
	"baseline_summary" text NOT NULL,
	"candidate_summary" text NOT NULL,
	"delta_summary" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "risk_simulations_sample_count" CHECK ("risk_simulations"."sample_count" BETWEEN 1 AND 50)
);
--> statement-breakpoint
ALTER TABLE "risk_rules" ADD COLUMN "family_id" text;--> statement-breakpoint
UPDATE "risk_rules" SET "family_id" = "id" WHERE "family_id" IS NULL;--> statement-breakpoint
ALTER TABLE "risk_rules" ALTER COLUMN "family_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_rules" ADD COLUMN "deployment" text DEFAULT 'champion' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_rule_promotions" ADD CONSTRAINT "risk_rule_promotions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rule_promotions" ADD CONSTRAINT "risk_rule_promotions_rule_id_risk_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."risk_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rule_promotions" ADD CONSTRAINT "risk_rule_promotions_previous_champion_id_risk_rules_id_fk" FOREIGN KEY ("previous_champion_id") REFERENCES "public"."risk_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_rule_promotions" ADD CONSTRAINT "risk_rule_promotions_promoted_by_users_id_fk" FOREIGN KEY ("promoted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_simulations" ADD CONSTRAINT "risk_simulations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_simulations" ADD CONSTRAINT "risk_simulations_candidate_rule_id_risk_rules_id_fk" FOREIGN KEY ("candidate_rule_id") REFERENCES "public"."risk_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_simulations" ADD CONSTRAINT "risk_simulations_baseline_rule_id_risk_rules_id_fk" FOREIGN KEY ("baseline_rule_id") REFERENCES "public"."risk_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_simulations" ADD CONSTRAINT "risk_simulations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_rule_promotions_org_idempotency" ON "risk_rule_promotions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_rule_promotions_org_created" ON "risk_rule_promotions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_simulations_org_idempotency" ON "risk_simulations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_simulations_org_created" ON "risk_simulations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_rules_org_family_version" ON "risk_rules" USING btree ("organization_id","family_id","version");--> statement-breakpoint
CREATE INDEX "idx_risk_rules_org_family_deployment" ON "risk_rules" USING btree ("organization_id","family_id","deployment");--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_version" CHECK ("risk_rules"."version" > 0);--> statement-breakpoint
ALTER TABLE "risk_rules" ADD CONSTRAINT "risk_rules_deployment" CHECK ("risk_rules"."deployment" IN ('champion', 'challenger', 'archived'));
