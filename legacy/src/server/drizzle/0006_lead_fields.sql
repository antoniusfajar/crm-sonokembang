ALTER TABLE "leads" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "expected_dp_month" date;