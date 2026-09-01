ALTER TABLE "live_gate_evidence" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "live_gate_evidence" CASCADE;--> statement-breakpoint
ALTER TABLE "platform_rails" DROP CONSTRAINT "platform_rails_required";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP CONSTRAINT "platform_rails_counterparty_kind";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP CONSTRAINT "platform_rails_status";--> statement-breakpoint
ALTER TABLE "platform_rails" ALTER COLUMN "status" SET DEFAULT 'integracion';--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "country";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "counterparty_kind";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "counterparty";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "required_for_live_money";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "evidence_ref";--> statement-breakpoint
ALTER TABLE "platform_rails" DROP COLUMN "certified_at";--> statement-breakpoint
DELETE FROM "platform_rails";--> statement-breakpoint
ALTER TABLE "platform_rails" ADD CONSTRAINT "platform_rails_status" CHECK ("platform_rails"."status" IN ('integracion', 'homologacion', 'go_live'));
--> statement-breakpoint
INSERT INTO "platform_rails" ("id", "status", "created_at", "updated_at") VALUES
	('account_lookup', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('transfers', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('debin', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('echeq', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('cvu', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('qr_interoperable', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('collections', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('card_issuing', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
	('bill_payments', 'integracion', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');