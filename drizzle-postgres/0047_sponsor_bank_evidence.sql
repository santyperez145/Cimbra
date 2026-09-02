ALTER TABLE "official_rail_connections" ADD COLUMN "counterparty_legal_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_rail_connections" ADD COLUMN "counterparty_tax_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_rail_connections" ADD COLUMN "contract_reference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_rail_connections" ADD COLUMN "safeguarding_account_ref" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_rail_connections" ADD COLUMN "due_diligence_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "official_rail_connections" DROP CONSTRAINT "official_rail_connections_status";--> statement-breakpoint
ALTER TABLE "official_rail_connections" ADD CONSTRAINT "official_rail_connections_status" CHECK ("status" IN ('unwired', 'negotiating', 'contracted', 'certified', 'live'));--> statement-breakpoint
INSERT INTO "official_rail_connections" (
  "id", "status", "evidence_note", "counterparty_legal_name", "counterparty_tax_id",
  "contract_reference", "safeguarding_account_ref", "due_diligence_json", "created_at", "updated_at"
)
VALUES
  (
    'sponsor_bank', 'unwired',
    'Candidato inicial: entidad financiera regulada (p. ej. BIND Banco como banco patrocinante). No implica integración bindX/BIND PSP.',
    '', '', '', '', '[]',
    '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'
  ),
  (
    'client_safeguarding', 'unwired',
    'Cuenta a la vista de fondos de clientes, distinta de la operativa. Se cablea junto al banco patrocinante.',
    '', '', '', '', '[]',
    '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'
  )
ON CONFLICT ("id") DO NOTHING;
