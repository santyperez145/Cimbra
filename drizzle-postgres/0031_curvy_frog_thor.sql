CREATE TABLE "echeq_endorsements" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"echeq_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"beneficiary_name" text NOT NULL,
	"beneficiary_tax_hash" text NOT NULL,
	"beneficiary_tax_last4" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "echeqs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"drawer_account_id" text NOT NULL,
	"holder_account_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"external_reference" text NOT NULL,
	"payload" text NOT NULL,
	"to_order" integer DEFAULT 1 NOT NULL,
	"payment_date" text NOT NULL,
	"expires_at" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"beneficiary_name" text NOT NULL,
	"beneficiary_tax_hash" text NOT NULL,
	"beneficiary_tax_last4" text NOT NULL,
	"endorsement_count" integer DEFAULT 0 NOT NULL,
	"reject_reason" text,
	"transaction_id" text,
	"accept_idempotency_key" text,
	"accept_fingerprint" text,
	"endorse_idempotency_key" text,
	"endorse_fingerprint" text,
	"deposit_idempotency_key" text,
	"deposit_fingerprint" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "echeqs_currency" CHECK ("echeqs"."currency" = 'ARS'),
	CONSTRAINT "echeqs_status" CHECK ("echeqs"."status" IN ('issued', 'accepted', 'endorsed', 'pending', 'deposited', 'cancelled', 'returned', 'rejected', 'expired')),
	CONSTRAINT "echeqs_amount_positive" CHECK ("echeqs"."amount_minor" > 0),
	CONSTRAINT "echeqs_to_order" CHECK ("echeqs"."to_order" IN (0, 1)),
	CONSTRAINT "echeqs_tax_last4" CHECK (length("echeqs"."beneficiary_tax_last4") = 4)
);
--> statement-breakpoint
ALTER TABLE "echeq_endorsements" ADD CONSTRAINT "echeq_endorsements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeq_endorsements" ADD CONSTRAINT "echeq_endorsements_echeq_id_echeqs_id_fk" FOREIGN KEY ("echeq_id") REFERENCES "public"."echeqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeq_endorsements" ADD CONSTRAINT "echeq_endorsements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeqs" ADD CONSTRAINT "echeqs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeqs" ADD CONSTRAINT "echeqs_drawer_account_id_accounts_id_fk" FOREIGN KEY ("drawer_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeqs" ADD CONSTRAINT "echeqs_holder_account_id_accounts_id_fk" FOREIGN KEY ("holder_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeqs" ADD CONSTRAINT "echeqs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echeqs" ADD CONSTRAINT "echeqs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeq_endorsements_org_idempotency" ON "echeq_endorsements" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_echeq_endorsements_echeq_created" ON "echeq_endorsements" USING btree ("echeq_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_org_idempotency" ON "echeqs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_org_reference" ON "echeqs" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_payload" ON "echeqs" USING btree ("payload");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_transaction" ON "echeqs" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_org_accept_idempotency" ON "echeqs" USING btree ("organization_id","accept_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_org_endorse_idempotency" ON "echeqs" USING btree ("organization_id","endorse_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_echeqs_org_deposit_idempotency" ON "echeqs" USING btree ("organization_id","deposit_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_echeqs_org_created" ON "echeqs" USING btree ("organization_id","created_at");