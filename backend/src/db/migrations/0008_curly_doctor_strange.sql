ALTER TABLE "leads" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "last_name";