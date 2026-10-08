DROP INDEX "metric_daily_uq";--> statement-breakpoint
ALTER TABLE "metric_daily" ADD COLUMN "account" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_daily_uq" ON "metric_daily" USING btree ("provider","account","metric","dim","day");