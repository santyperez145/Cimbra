CREATE TABLE "book_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"external_reference" text NOT NULL,
	"source_account_id" text NOT NULL,
	"destination_account_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"reversal_transaction_id" text,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'settled' NOT NULL,
	"created_by" text NOT NULL,
	"reversed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "book_transfers_distinct_accounts" CHECK ("book_transfers"."source_account_id" <> "book_transfers"."destination_account_id"),
	CONSTRAINT "book_transfers_amount_positive" CHECK ("book_transfers"."amount_minor" > 0),
	CONSTRAINT "book_transfers_status" CHECK ("book_transfers"."status" IN ('review', 'settled', 'reversed', 'cancelled')),
	CONSTRAINT "book_transfers_currency" CHECK ("book_transfers"."currency" IN ('ARS', 'USD', 'MXN', 'COP', 'BRL', 'CLP', 'PEN'))
);
--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_reversal_transaction_id_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_transfers" ADD CONSTRAINT "book_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_book_transfers_org_idempotency" ON "book_transfers" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_book_transfers_org_reference" ON "book_transfers" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_book_transfers_transaction" ON "book_transfers" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_book_transfers_reversal" ON "book_transfers" USING btree ("reversal_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_book_transfers_org_created" ON "book_transfers" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_book_transfers_source_created" ON "book_transfers" USING btree ("source_account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_book_transfers_destination_created" ON "book_transfers" USING btree ("destination_account_id","created_at");