ALTER TABLE "follow_ups" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_delivered_template_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "generation_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "send_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "positive_intent_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "negative_reply_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "spam_complaint_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_template_id_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_delivered_template_id_prompt_templates_id_fk" FOREIGN KEY ("last_delivered_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;