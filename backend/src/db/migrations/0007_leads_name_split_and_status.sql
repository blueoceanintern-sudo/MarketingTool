ALTER TABLE "leads" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status" "lead_status" DEFAULT 'new' NOT NULL;
