CREATE TABLE "campaign_lead_exclusions" (
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"excluded_at" timestamp DEFAULT now() NOT NULL,
	"excluded_by" text NOT NULL,
	"reason" text,
	CONSTRAINT "campaign_lead_exclusions_lead_id_campaign_id_pk" PRIMARY KEY("lead_id","campaign_id")
);
--> statement-breakpoint
ALTER TABLE "suppression_list" DROP CONSTRAINT "suppression_list_email_unique";--> statement-breakpoint
ALTER TABLE "suppression_list" ALTER COLUMN "reason" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."suppression_reason";--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'manual');--> statement-breakpoint
ALTER TABLE "suppression_list" ALTER COLUMN "reason" SET DATA TYPE "public"."suppression_reason" USING "reason"::"public"."suppression_reason";--> statement-breakpoint
ALTER TABLE "suppression_list" ADD COLUMN "campaign_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_lead_exclusions" ADD CONSTRAINT "campaign_lead_exclusions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lead_exclusions" ADD CONSTRAINT "campaign_lead_exclusions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_lead_exclusions_campaign_id_idx" ON "campaign_lead_exclusions" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppression_list_campaign_id_idx" ON "suppression_list" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_email_campaign_unique" UNIQUE("email","campaign_id");