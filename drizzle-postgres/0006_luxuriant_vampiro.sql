CREATE TABLE "auth_action_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "auth_action_tokens_type" CHECK ("auth_action_tokens"."type" IN ('email_verification', 'password_reset', 'mfa_challenge'))
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "auth_action_tokens" ADD CONSTRAINT "auth_action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auth_action_tokens_hash" ON "auth_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_auth_action_tokens_user_type" ON "auth_action_tokens" USING btree ("user_id","type","created_at");--> statement-breakpoint
CREATE INDEX "idx_auth_action_tokens_expires" ON "auth_action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mfa_recovery_codes_hash" ON "mfa_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "idx_mfa_recovery_codes_user" ON "mfa_recovery_codes" USING btree ("user_id","consumed_at");