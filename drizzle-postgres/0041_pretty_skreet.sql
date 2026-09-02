ALTER TABLE "payment_links" DROP CONSTRAINT "payment_links_paid_method";--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "qr_debt_id" text;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "collection_till_id" text;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_qr_debt_id_qr_debts_id_fk" FOREIGN KEY ("qr_debt_id") REFERENCES "public"."qr_debts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_collection_till_id_collection_tills_id_fk" FOREIGN KEY ("collection_till_id") REFERENCES "public"."collection_tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_links_qr_debt" ON "payment_links" USING btree ("qr_debt_id") WHERE "payment_links"."qr_debt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payment_links_collection_till" ON "payment_links" USING btree ("collection_till_id");--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_paid_method" CHECK ("payment_links"."paid_method" IS NULL OR "payment_links"."paid_method" IN ('internal', 'sandbox_inbound', 'cimbra_qr', 'cimbra_cvu'));