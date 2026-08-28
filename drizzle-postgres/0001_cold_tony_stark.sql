CREATE TABLE "financial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"account_class" text NOT NULL,
	"normal_balance" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "financial_accounts_class" CHECK ("financial_accounts"."account_class" IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "financial_accounts_normal_balance" CHECK ("financial_accounts"."normal_balance" IN ('debit', 'credit'))
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"transaction_id" text,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "holds_amount_positive" CHECK ("holds"."amount_minor" > 0),
	CONSTRAINT "holds_status" CHECK ("holds"."status" IN ('active', 'captured', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"transaction_id" text,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversal_of" text,
	"posted_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "ledger_journals_status" CHECK ("ledger_journals"."status" IN ('posted', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"journal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "ledger_postings_direction" CHECK ("ledger_postings"."direction" IN ('debit', 'credit')),
	CONSTRAINT "ledger_postings_amount_positive" CHECK ("ledger_postings"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ledger_account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reversal_of" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_reversal_of_ledger_journals_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_financial_accounts_org_purpose_currency" ON "financial_accounts" USING btree ("organization_id","purpose","currency");--> statement-breakpoint
CREATE INDEX "idx_financial_accounts_org" ON "financial_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_holds_org_idempotency" ON "holds" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_holds_account_status" ON "holds" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ledger_journals_org_idempotency" ON "ledger_journals" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ledger_journals_transaction" ON "ledger_journals" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_journals_org_created" ON "ledger_journals" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_journals_reversal" ON "ledger_journals" USING btree ("reversal_of");--> statement-breakpoint
CREATE INDEX "idx_ledger_postings_journal" ON "ledger_postings" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_postings_account_created" ON "ledger_postings" USING btree ("account_id","created_at");--> statement-breakpoint
INSERT INTO "financial_accounts"
  ("id", "organization_id", "purpose", "name", "currency", "account_class", "normal_balance", "status", "created_at")
SELECT
  'legacy-' || "id", "organization_id", 'customer_account:' || "id", 'Cuenta ' || "account_reference",
  "currency", 'liability', 'credit', "status", "created_at"
FROM "accounts";--> statement-breakpoint
UPDATE "accounts" SET "ledger_account_id" = 'legacy-' || "id" WHERE "ledger_account_id" IS NULL;--> statement-breakpoint
UPDATE "transactions"
SET "amount_minor" = ROUND("amount" * CASE WHEN "currency" = 'CLP' THEN 1 ELSE 100 END)::bigint,
    "updated_at" = "created_at"
WHERE "amount_minor" IS NULL;--> statement-breakpoint
INSERT INTO "financial_accounts"
  ("id", "organization_id", "purpose", "name", "currency", "account_class", "normal_balance", "status", "created_at")
SELECT DISTINCT
  'core-settlement-' || SUBSTRING(MD5("organization_id" || ':' || "currency"), 1, 24),
  "organization_id", 'settlement', 'Fondos de liquidación ' || "currency", "currency", 'asset', 'debit', 'active', MIN("created_at")
FROM "transactions"
GROUP BY "organization_id", "currency"
ON CONFLICT ("organization_id", "purpose", "currency") DO NOTHING;--> statement-breakpoint
INSERT INTO "financial_accounts"
  ("id", "organization_id", "purpose", "name", "currency", "account_class", "normal_balance", "status", "created_at")
SELECT DISTINCT
  'core-customer-' || SUBSTRING(MD5("organization_id" || ':' || "currency"), 1, 24),
  "organization_id", 'customer_funds', 'Fondos de clientes ' || "currency", "currency", 'liability', 'credit', 'active', MIN("created_at")
FROM "transactions"
GROUP BY "organization_id", "currency"
ON CONFLICT ("organization_id", "purpose", "currency") DO NOTHING;--> statement-breakpoint
INSERT INTO "ledger_journals"
  ("id", "organization_id", "transaction_id", "idempotency_key", "kind", "description", "currency", "status", "reversal_of", "posted_at", "created_at")
SELECT
  'legacy-journal-' || SUBSTRING(MD5(t."id"), 1, 24), t."organization_id", t."id",
  'legacy:' || t."idempotency_key", CASE WHEN t."amount_minor" > 0 THEN 'funding' ELSE 'transfer' END,
  t."description", t."currency", 'posted', NULL, t."created_at", t."created_at"
FROM "transactions" t
WHERE t."status" = 'settled'
ON CONFLICT ("transaction_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "ledger_postings"
  ("id", "organization_id", "journal_id", "account_id", "direction", "amount_minor", "currency", "created_at")
SELECT
  'legacy-debit-' || SUBSTRING(MD5(t."id"), 1, 24), t."organization_id", j."id",
  CASE WHEN t."amount_minor" > 0 THEN settlement."id" ELSE customer_funds."id" END,
  'debit', ABS(t."amount_minor"), t."currency", t."created_at"
FROM "transactions" t
JOIN "ledger_journals" j ON j."transaction_id" = t."id"
JOIN "financial_accounts" settlement ON settlement."organization_id" = t."organization_id" AND settlement."currency" = t."currency" AND settlement."purpose" = 'settlement'
JOIN "financial_accounts" customer_funds ON customer_funds."organization_id" = t."organization_id" AND customer_funds."currency" = t."currency" AND customer_funds."purpose" = 'customer_funds'
WHERE t."status" = 'settled'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "ledger_postings"
  ("id", "organization_id", "journal_id", "account_id", "direction", "amount_minor", "currency", "created_at")
SELECT
  'legacy-credit-' || SUBSTRING(MD5(t."id"), 1, 24), t."organization_id", j."id",
  CASE WHEN t."amount_minor" > 0 THEN customer_funds."id" ELSE settlement."id" END,
  'credit', ABS(t."amount_minor"), t."currency", t."created_at"
FROM "transactions" t
JOIN "ledger_journals" j ON j."transaction_id" = t."id"
JOIN "financial_accounts" settlement ON settlement."organization_id" = t."organization_id" AND settlement."currency" = t."currency" AND settlement."purpose" = 'settlement'
JOIN "financial_accounts" customer_funds ON customer_funds."organization_id" = t."organization_id" AND customer_funds."currency" = t."currency" AND customer_funds."purpose" = 'customer_funds'
WHERE t."status" = 'settled'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "holds"
  ("id", "organization_id", "account_id", "transaction_id", "idempotency_key", "amount_minor", "currency", "status", "expires_at", "created_at", "updated_at")
SELECT
  'legacy-hold-' || SUBSTRING(MD5(t."id"), 1, 24), t."organization_id", customer_funds."id", t."id",
  'legacy:' || t."idempotency_key", ABS(t."amount_minor"), t."currency", 'active', NULL, t."created_at", t."updated_at"
FROM "transactions" t
JOIN "financial_accounts" customer_funds ON customer_funds."organization_id" = t."organization_id" AND customer_funds."currency" = t."currency" AND customer_funds."purpose" = 'customer_funds'
WHERE t."status" IN ('authorized', 'review') AND t."amount_minor" < 0
ON CONFLICT ("organization_id", "idempotency_key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "ledger_account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_ledger_account_id_financial_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reversal_of_transactions_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_accounts_ledger_account" ON "accounts" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_transactions_reversal" ON "transactions" USING btree ("reversal_of");--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_nonzero" CHECK ("transactions"."amount_minor" <> 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_risk_range" CHECK ("transactions"."risk_score" BETWEEN 0 AND 100);--> statement-breakpoint
CREATE OR REPLACE FUNCTION cimbra_prepare_legacy_transaction_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_minor IS NULL THEN
    NEW.amount_minor := ROUND(NEW.amount * CASE WHEN NEW.currency = 'CLP' THEN 1 ELSE 100 END)::bigint;
  ELSIF NEW.amount = 0 THEN
    NEW.amount := NEW.amount_minor::double precision / CASE WHEN NEW.currency = 'CLP' THEN 1 ELSE 100 END;
  END IF;
  IF NEW.updated_at IS NULL THEN
    NEW.updated_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER transactions_legacy_insert_compatibility
BEFORE INSERT ON transactions
FOR EACH ROW EXECUTE FUNCTION cimbra_prepare_legacy_transaction_insert();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cimbra_prepare_legacy_account_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.ledger_account_id IS NULL THEN
    NEW.ledger_account_id := 'legacy-' || NEW.id;
    INSERT INTO financial_accounts
      (id, organization_id, purpose, name, currency, account_class, normal_balance, status, created_at)
    VALUES
      (NEW.ledger_account_id, NEW.organization_id, 'customer_account:' || NEW.id, 'Cuenta ' || NEW.account_reference,
       NEW.currency, 'liability', 'credit', NEW.status, NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER accounts_legacy_insert_compatibility
BEFORE INSERT ON accounts
FOR EACH ROW EXECUTE FUNCTION cimbra_prepare_legacy_account_insert();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cimbra_validate_journal_balance() RETURNS trigger AS $$
DECLARE
  target_journal_id text;
  debit_total numeric;
  credit_total numeric;
  posting_count integer;
  invalid_postings integer;
BEGIN
  IF TG_TABLE_NAME = 'ledger_journals' THEN
    target_journal_id := NEW.id;
  ELSE
    target_journal_id := NEW.journal_id;
  END IF;
  SELECT
    COALESCE(SUM(CASE WHEN p.direction = 'debit' THEN p.amount_minor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN p.direction = 'credit' THEN p.amount_minor ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE p.organization_id <> j.organization_id OR p.currency <> j.currency OR a.organization_id <> j.organization_id OR a.currency <> j.currency)
  INTO debit_total, credit_total, posting_count, invalid_postings
  FROM ledger_journals j
  LEFT JOIN ledger_postings p ON p.journal_id = j.id
  LEFT JOIN financial_accounts a ON a.id = p.account_id
  WHERE j.id = target_journal_id
  GROUP BY j.id;
  IF posting_count < 2 OR debit_total <> credit_total OR debit_total <= 0 OR invalid_postings > 0 THEN
    RAISE EXCEPTION 'ledger journal % is unbalanced or crosses tenant/currency boundaries', target_journal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_journal_balance_guard
AFTER INSERT OR UPDATE OF status ON ledger_journals
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION cimbra_validate_journal_balance();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_posting_balance_guard
AFTER INSERT ON ledger_postings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION cimbra_validate_journal_balance();--> statement-breakpoint
CREATE OR REPLACE FUNCTION cimbra_prevent_posting_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM organizations WHERE id = OLD.organization_id AND status = 'deleting'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger postings are immutable; create a reversal journal';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER ledger_posting_immutable
BEFORE UPDATE OR DELETE ON ledger_postings
FOR EACH ROW EXECUTE FUNCTION cimbra_prevent_posting_mutation();
