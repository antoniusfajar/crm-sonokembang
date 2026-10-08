CREATE TYPE "public"."role" AS ENUM('sales', 'marketing', 'spv', 'admin');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('aktif', 'cuti', 'nonaktif');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_idr" integer DEFAULT 0 NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_phone" text NOT NULL,
	"name" text,
	"contact_type" text DEFAULT 'Calon pelanggan' NOT NULL,
	"email" text,
	"company" text,
	"source_id" uuid,
	"owner_id" uuid,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"assignee_id" uuid,
	"ai_active" boolean DEFAULT true NOT NULL,
	"handoff_at" timestamp with time zone,
	"handoff_reason" text,
	"handoff_summary" text,
	"handoff_claimed_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"awaiting_reply_since" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"sla_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"ai_fillable" boolean DEFAULT false NOT NULL,
	"show_in_table" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution_members" (
	"user_id" uuid NOT NULL,
	"channel" text DEFAULT 'default' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "distribution_members_user_id_channel_pk" PRIMARY KEY("user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "guardrail_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"layer" integer NOT NULL,
	"reason" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"rows" jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"ref_code" text,
	"how_recorded" text,
	"offline" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" serial NOT NULL,
	"contact_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"owner_id" uuid,
	"source_id" uuid,
	"origin" text DEFAULT 'auto' NOT NULL,
	"origin_note" text,
	"event_type" text,
	"event_date" date,
	"event_date_text" text,
	"location" text,
	"pax" integer,
	"budget" bigint,
	"estimated_value" bigint,
	"potensi" text,
	"ai_filled" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"score_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"temperature" text DEFAULT 'Cold' NOT NULL,
	"lost_kind" text,
	"lost_reason" text,
	"lost_note" text,
	"dp_amount" bigint,
	"dp_date" date,
	"dp_proof_path" text,
	"closed_at" timestamp with time zone,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"success" boolean NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"user_id" uuid,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"template_name" text,
	"media_path" text,
	"media_name" text,
	"wa_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#db6262' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"target_share" integer DEFAULT 0 NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"note" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"segment" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"template_id" uuid,
	"price_per_pax" bigint NOT NULL,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"file_path" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_settings" (
	"role" "role" PRIMARY KEY NOT NULL,
	"menus" jsonb NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder" text DEFAULT 'Umum' NOT NULL,
	"name" text NOT NULL,
	"shortcut" text NOT NULL,
	"body" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"sla_days" integer,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'Follow-up' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"auto" boolean DEFAULT false NOT NULL,
	"rule_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_foods" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"place" text,
	"people" integer,
	"result" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"status" "user_status" DEFAULT 'aktif' NOT NULL,
	"phone" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'id' NOT NULL,
	"category" text DEFAULT 'UTILITY' NOT NULL,
	"body" text NOT NULL,
	"folder" text DEFAULT 'Umum' NOT NULL,
	"status" text DEFAULT 'LOCAL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_members" ADD CONSTRAINT "distribution_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_logs" ADD CONSTRAINT "guardrail_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_template_id_proposal_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."proposal_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_foods" ADD CONSTRAINT "test_foods_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_foods" ADD CONSTRAINT "test_foods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_at_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_wa_uq" ON "contacts" USING btree ("wa_phone");--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_contact_channel_uq" ON "conversations" USING btree ("contact_id","channel");--> statement-breakpoint
CREATE INDEX "conversations_assignee_idx" ON "conversations" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "conversations_last_msg_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_entity_key_uq" ON "custom_fields" USING btree ("entity","key");--> statement-breakpoint
CREATE INDEX "guardrail_at_idx" ON "guardrail_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_ref_uq" ON "lead_sources" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX "lsh_lead_idx" ON "lead_stage_history" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_contact_idx" ON "leads" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_code_uq" ON "leads" USING btree ("code");--> statement-breakpoint
CREATE INDEX "messages_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_wa_id_uq" ON "messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE INDEX "notes_contact_idx" ON "notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snippets_shortcut_uq" ON "snippets" USING btree ("shortcut");--> statement-breakpoint
CREATE INDEX "stages_pipeline_idx" ON "stages" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "tasks_user_due_idx" ON "tasks" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_rule_uq" ON "tasks" USING btree ("lead_id","rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_templates_name_lang_uq" ON "wa_templates" USING btree ("name","language");