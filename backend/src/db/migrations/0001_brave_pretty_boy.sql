CREATE TYPE "public"."email_status" AS ENUM('verified', 'pattern_guessed', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."enrichment_routing" AS ENUM('auto_queue', 'rep_review');--> statement-breakpoint
CREATE TYPE "public"."enrichment_source" AS ENUM('registry', 'cowork_claude', 'snovio', 'manual');--> statement-breakpoint
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
ALTER TABLE "leads" ADD COLUMN "email_status" "email_status";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "enrichment_source" "enrichment_source";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "routing" "enrichment_routing";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "enrichment_records" ADD CONSTRAINT "enrichment_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_records" ADD CONSTRAINT "enrichment_records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_records_lead_enriched_at_idx" ON "enrichment_records" USING btree ("lead_id","enriched_at" DESC NULLS LAST);