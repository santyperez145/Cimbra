CREATE TABLE "live_gate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"gate_id" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_at" text NOT NULL,
	CONSTRAINT "live_gate_evidence_kind" CHECK ("live_gate_evidence"."kind" IN ('document', 'contract', 'pentest', 'slo', 'license', 'rail_certification'))
);
--> statement-breakpoint
CREATE TABLE "platform_rails" (
	"id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"kind" text NOT NULL,
	"counterparty_kind" text NOT NULL,
	"counterparty" text NOT NULL,
	"required_for_live_money" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"evidence_ref" text,
	"certified_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "platform_rails_required" CHECK ("platform_rails"."required_for_live_money" IN (0, 1)),
	CONSTRAINT "platform_rails_status" CHECK ("platform_rails"."status" IN ('disconnected', 'pending_certification', 'certified', 'live')),
	CONSTRAINT "platform_rails_counterparty_kind" CHECK ("platform_rails"."counterparty_kind" IN ('clearing_house', 'bank', 'card_scheme', 'official_registry', 'regulated_sponsor'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "environment" text DEFAULT 'test' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_live_gate_evidence_gate" ON "live_gate_evidence" USING btree ("gate_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_platform_rails_status" ON "platform_rails" USING btree ("status");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment" CHECK ("api_keys"."environment" IN ('test', 'live'));
--> statement-breakpoint
INSERT INTO "platform_rails" ("id", "country", "kind", "counterparty_kind", "counterparty", "required_for_live_money", "status", "created_at", "updated_at") VALUES
	('ar_coelsa_transfers', 'AR', 'instant_credit', 'clearing_house', 'Coelsa', 1, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_coelsa_debin', 'AR', 'instant_debit', 'clearing_house', 'Coelsa', 1, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_coelsa_echeq', 'AR', 'echeq_clearing', 'clearing_house', 'Coelsa', 1, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_cbu_directory', 'AR', 'account_directory', 'clearing_house', 'Coelsa', 1, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_card_issuing', 'AR', 'card_issuing', 'card_scheme', 'Esquema o BIN sponsor regulado', 0, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_card_acquiring', 'AR', 'card_acquiring', 'card_scheme', 'Esquema o adquirente regulado', 0, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('ar_biller_originators', 'AR', 'bill_payments', 'official_registry', 'Originadores y redes de cobranza directos', 0, 'disconnected', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');