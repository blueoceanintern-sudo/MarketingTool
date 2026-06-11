ALTER TABLE "campaign_leads" ADD COLUMN "status" "lead_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "status";