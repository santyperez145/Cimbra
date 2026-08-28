ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_minute" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rate_window_started_at" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rate_window_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_rate_limit_positive" CHECK ("api_keys"."rate_limit_per_minute" > 0 AND "api_keys"."rate_window_count" >= 0);