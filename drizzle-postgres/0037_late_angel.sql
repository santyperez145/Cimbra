CREATE TABLE "qr_sale_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"payment_qr_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"external_reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" text NOT NULL,
	"paid_transfer_id" text,
	"cancel_idempotency_key" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "qr_sale_orders_currency" CHECK ("qr_sale_orders"."currency" = 'ARS'),
	CONSTRAINT "qr_sale_orders_status" CHECK ("qr_sale_orders"."status" IN ('pending', 'paid', 'expired', 'cancelled', 'superseded')),
	CONSTRAINT "qr_sale_orders_amount_positive" CHECK ("qr_sale_orders"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "qr_sale_orders" ADD CONSTRAINT "qr_sale_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_sale_orders" ADD CONSTRAINT "qr_sale_orders_payment_qr_id_payment_qrs_id_fk" FOREIGN KEY ("payment_qr_id") REFERENCES "public"."payment_qrs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_sale_orders" ADD CONSTRAINT "qr_sale_orders_paid_transfer_id_instant_transfers_id_fk" FOREIGN KEY ("paid_transfer_id") REFERENCES "public"."instant_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_sale_orders" ADD CONSTRAINT "qr_sale_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_sale_orders_org_idempotency" ON "qr_sale_orders" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_sale_orders_org_reference" ON "qr_sale_orders" USING btree ("organization_id","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_sale_orders_qr_pending" ON "qr_sale_orders" USING btree ("payment_qr_id") WHERE "qr_sale_orders"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qr_sale_orders_org_cancel_idempotency" ON "qr_sale_orders" USING btree ("organization_id","cancel_idempotency_key") WHERE "qr_sale_orders"."cancel_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_qr_sale_orders_org_created" ON "qr_sale_orders" USING btree ("organization_id","created_at");