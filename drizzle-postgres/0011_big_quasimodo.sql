CREATE TABLE "organization_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by" text,
	"expires_at" text NOT NULL,
	"accepted_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "organization_invitations_role" CHECK ("organization_invitations"."role" IN ('admin', 'operator', 'viewer')),
	CONSTRAINT "organization_invitations_status" CHECK ("organization_invitations"."status" IN ('pending', 'accepted', 'revoked', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organization_invitations_org_email" ON "organization_invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_organization_invitations_email_status" ON "organization_invitations" USING btree ("email","status","expires_at");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_role" CHECK ("members"."role" IN ('owner', 'admin', 'operator', 'viewer'));