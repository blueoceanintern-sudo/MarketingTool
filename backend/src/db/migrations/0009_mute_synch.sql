ALTER TABLE "leads" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "leads" SET "name" = NULLIF(TRIM(CONCAT_WS(' ', "first_name", "last_name")), '');--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "last_name";