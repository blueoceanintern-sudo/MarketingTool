CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'complete');--> statement-breakpoint
CREATE TYPE "public"."company_size" AS ENUM('small', 'medium', 'large', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending_review', 'approved', 'rejected', 'scheduled', 'sent');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('verified', 'pattern_guessed', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."enrichment_routing" AS ENUM('auto_queue', 'rep_review');--> statement-breakpoint
CREATE TYPE "public"."enrichment_source" AS ENUM('registry', 'cowork_claude', 'snovio', 'manual');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('duplicate', 'unverified_email', 'missing_field', 'legal_keyword', 'hostile_interaction', 'regulated_entity');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'replied', 'converted', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."scrape_job_status" AS ENUM('queued', 'running', 'complete', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."scraper_type" AS ENUM('crawl4ai', 'cheerio', 'api');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'negative', 'neutral', 'out_of_office');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'manual');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"target_type" text,
	"ip_address" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "campaign_lead_exclusions" (
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"excluded_at" timestamp DEFAULT now() NOT NULL,
	"excluded_by" text NOT NULL,
	"reason" text,
	CONSTRAINT "campaign_lead_exclusions_lead_id_campaign_id_pk" PRIMARY KEY("lead_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"source" text,
	CONSTRAINT "campaign_leads_lead_id_campaign_id_pk" PRIMARY KEY("lead_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vertical" text NOT NULL,
	"geography" text NOT NULL,
	"company_size_target" "company_size" NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"pain_points" text[],
	"call_to_action" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"industry" text NOT NULL,
	"company_size" "company_size" NOT NULL,
	"location" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"assigned_to" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"confidence_score" real NOT NULL,
	"status" "draft_status" DEFAULT 'pending_review' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"body_embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_drafts_lead_campaign_unique" UNIQUE("lead_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"ses_message_id" text,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"replied_at" timestamp,
	"unsubscribed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "enrichment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid,
	"enriched_at" timestamp NOT NULL,
	"enrichment_source" "enrichment_source" NOT NULL,
	"market" text NOT NULL,
	"institution" json NOT NULL,
	"contact" json NOT NULL,
	"pipeline_flags" json NOT NULL,
	"routing" "enrichment_routing" NOT NULL,
	"routing_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"draft_id" uuid,
	"subject" text,
	"body" text,
	"angle_tag" text
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text NOT NULL,
	"role" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"email_status" "email_status",
	"enrichment_source" "enrichment_source",
	"routing" "enrichment_routing",
	"enriched_at" timestamp,
	"scraper_used" "scraper_type",
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leads_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"template_type" text DEFAULT 'initial' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"parent_template_id" uuid,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_event_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"category" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"flag_type" "flag_type" NOT NULL,
	"flagged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" "scrape_job_status" DEFAULT 'queued' NOT NULL,
	"leads_scraped" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vertical" text NOT NULL,
	"geo" text NOT NULL,
	"url" text NOT NULL,
	"scraper_type" "scraper_type" NOT NULL,
	"legal_flag" boolean DEFAULT false NOT NULL,
	"selectors" json,
	"active" boolean DEFAULT true NOT NULL,
	"generated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_registry_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_list_email_campaign_unique" UNIQUE("email","campaign_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_lead_exclusions" ADD CONSTRAINT "campaign_lead_exclusions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lead_exclusions" ADD CONSTRAINT "campaign_lead_exclusions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_template_id_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_draft_id_email_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_records" ADD CONSTRAINT "enrichment_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_records" ADD CONSTRAINT "enrichment_records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_draft_id_email_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_email_event_id_email_events_id_fk" FOREIGN KEY ("email_event_id") REFERENCES "public"."email_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_registry" ADD CONSTRAINT "source_registry_generated_by_campaigns_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_lead_exclusions_campaign_id_idx" ON "campaign_lead_exclusions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_id_idx" ON "campaign_leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_drafts_body_embedding_idx" ON "email_drafts" USING hnsw ("body_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "enrichment_records_lead_enriched_at_idx" ON "enrichment_records" USING btree ("lead_id","enriched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "suppression_list_campaign_id_idx" ON "suppression_list" USING btree ("campaign_id");