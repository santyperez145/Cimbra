CREATE TABLE "capital_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'authorized_unspent' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "capital_allocations_status" CHECK ("status" IN ('authorized_unspent', 'spent', 'exhausted'))
);
--> statement-breakpoint
INSERT INTO "capital_allocations" ("id", "status", "note", "updated_at")
VALUES
  ('legal_consult', 'authorized_unspent', '', '2026-09-02T00:00:00.000Z'),
  ('trademark_domain', 'authorized_unspent', '', '2026-09-02T00:00:00.000Z'),
  ('design_partners', 'authorized_unspent', '', '2026-09-02T00:00:00.000Z'),
  ('transactional_email', 'authorized_unspent', '', '2026-09-02T00:00:00.000Z')
ON CONFLICT ("id") DO NOTHING;
