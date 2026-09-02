CREATE TABLE "official_rail_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'unwired' NOT NULL,
	"evidence_note" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "official_rail_connections_status" CHECK ("official_rail_connections"."status" IN ('unwired', 'contracted', 'certified', 'live'))
);
--> statement-breakpoint
CREATE INDEX "idx_official_rail_connections_status" ON "official_rail_connections" USING btree ("status");