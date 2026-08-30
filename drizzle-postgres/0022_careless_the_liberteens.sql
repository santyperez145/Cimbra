CREATE TABLE "risk_step_up_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint_ciphertext" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"result" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "risk_step_up_attempt_number" CHECK ("risk_step_up_attempts"."attempt_number" > 0),
	CONSTRAINT "risk_step_up_attempt_result" CHECK ("risk_step_up_attempts"."result" IN ('matched', 'mismatch', 'expired', 'locked'))
);
--> statement-breakpoint
CREATE TABLE "risk_step_up_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"evaluation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"method" text DEFAULT 'otp' NOT NULL,
	"delivery" text DEFAULT 'client_managed' NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_salt" text NOT NULL,
	"credential_iterations" integer NOT NULL,
	"credential_ciphertext" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" text NOT NULL,
	"verified_at" text,
	"failed_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "risk_step_up_method" CHECK ("risk_step_up_challenges"."method" IN ('otp')),
	CONSTRAINT "risk_step_up_delivery" CHECK ("risk_step_up_challenges"."delivery" IN ('client_managed')),
	CONSTRAINT "risk_step_up_status" CHECK ("risk_step_up_challenges"."status" IN ('pending', 'verified', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "risk_step_up_attempts" CHECK ("risk_step_up_challenges"."attempt_count" >= 0 AND "risk_step_up_challenges"."attempt_count" <= "risk_step_up_challenges"."max_attempts"),
	CONSTRAINT "risk_step_up_max_attempts" CHECK ("risk_step_up_challenges"."max_attempts" BETWEEN 1 AND 10)
);
--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD COLUMN "decision_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "risk_step_up_attempts" ADD CONSTRAINT "risk_step_up_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_step_up_attempts" ADD CONSTRAINT "risk_step_up_attempts_challenge_id_risk_step_up_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."risk_step_up_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_step_up_challenges" ADD CONSTRAINT "risk_step_up_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_step_up_challenges" ADD CONSTRAINT "risk_step_up_challenges_evaluation_id_risk_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."risk_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_step_up_challenges" ADD CONSTRAINT "risk_step_up_challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_step_up_attempts_org_idempotency" ON "risk_step_up_attempts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_risk_step_up_attempts_challenge_created" ON "risk_step_up_attempts" USING btree ("challenge_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_step_up_org_idempotency" ON "risk_step_up_challenges" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_risk_step_up_one_pending_evaluation" ON "risk_step_up_challenges" USING btree ("organization_id","evaluation_id") WHERE "risk_step_up_challenges"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_risk_step_up_org_status_expiry" ON "risk_step_up_challenges" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_risk_step_up_evaluation_created" ON "risk_step_up_challenges" USING btree ("evaluation_id","created_at");--> statement-breakpoint
ALTER TABLE "risk_evaluations" ADD CONSTRAINT "risk_evaluations_latency" CHECK ("risk_evaluations"."decision_latency_ms" IS NULL OR "risk_evaluations"."decision_latency_ms" >= 0);