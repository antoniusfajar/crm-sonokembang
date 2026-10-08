ALTER TABLE "tasks" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "test_foods" ADD COLUMN "menus" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "test_foods" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "test_foods" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "test_foods" ADD COLUMN "result_at" timestamp with time zone;