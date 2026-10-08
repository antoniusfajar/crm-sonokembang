CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"ad_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"wa_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"reply_text" text,
	"lead_id" uuid
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"segment" jsonb NOT NULL,
	"segment_label" text NOT NULL,
	"template_name" text NOT NULL,
	"template_language" text DEFAULT 'id' NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cost_per_msg" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"maps_url" text,
	"rating" double precision,
	"review_count" integer,
	"notes" text,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"page" text,
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"purpose" text DEFAULT 'lead' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text NOT NULL,
	"account_type" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"sync_on" boolean DEFAULT true NOT NULL,
	"cred_enc" text,
	"expires_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"metric" text NOT NULL,
	"dim" text DEFAULT '' NOT NULL,
	"day" date NOT NULL,
	"value" double precision NOT NULL,
	"manual" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platforms" jsonb NOT NULL,
	"caption" text NOT NULL,
	"media_path" text,
	"media_name" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'gbp' NOT NULL,
	"external_id" text NOT NULL,
	"author" text DEFAULT 'Anonim' NOT NULL,
	"rating" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"reply_text" text,
	"replied_at" timestamp with time zone,
	"reply_status" text DEFAULT 'none' NOT NULL,
	"reply_due_at" timestamp with time zone,
	"reply_error" text,
	"sentiment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"media_type" text,
	"permalink" text,
	"published_at" timestamp with time zone NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_broadcast_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ad_ref_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_schedules" ADD CONSTRAINT "post_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_ext_uq" ON "ad_campaigns" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_uq" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_wa_idx" ON "broadcast_recipients" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_contact_idx" ON "broadcast_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "broadcasts_sched_idx" ON "broadcasts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_slug_uq" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_provider_account_uq" ON "integrations" USING btree ("provider","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_daily_uq" ON "metric_daily" USING btree ("provider","metric","dim","day");--> statement-breakpoint
CREATE INDEX "metric_daily_day_idx" ON "metric_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "post_schedules_at_idx" ON "post_schedules" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_ext_uq" ON "reviews" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "reviews_at_idx" ON "reviews" USING btree ("reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_uq" ON "social_posts" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "social_posts_pub_idx" ON "social_posts" USING btree ("published_at");