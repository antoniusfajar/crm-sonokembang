ALTER TABLE "contacts" ADD COLUMN "legacy_id" text;--> statement-breakpoint
CREATE INDEX "contacts_legacy_idx" ON "contacts" USING btree ("legacy_id");