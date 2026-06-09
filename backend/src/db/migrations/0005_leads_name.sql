ALTER TABLE "leads" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "leads" SET "name" = TRIM(CONCAT_WS(' ', "first_name", "last_name")) WHERE "first_name" IS NOT NULL OR "last_name" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "first_name";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "last_name";
