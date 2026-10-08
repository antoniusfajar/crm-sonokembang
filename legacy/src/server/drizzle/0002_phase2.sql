CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"audience" text NOT NULL,
	"format" text NOT NULL,
	"frequency" text NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"day_of_week" integer DEFAULT 1 NOT NULL,
	"time" text DEFAULT '07:00' NOT NULL,
	"recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"audience" text NOT NULL,
	"format" text NOT NULL,
	"notes" text,
	"data" jsonb NOT NULL,
	"narrative" jsonb NOT NULL,
	"ai_used" boolean DEFAULT false NOT NULL,
	"file_path" text,
	"schedule_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"period" text NOT NULL,
	"scope" text NOT NULL,
	"amount" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_period_scope_pk" PRIMARY KEY("period","scope")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deal_value" bigint;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_created_idx" ON "reports" USING btree ("created_at");