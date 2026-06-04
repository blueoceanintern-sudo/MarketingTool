-- Remove 'hostile' from sentiment enum
-- PostgreSQL requires recreating the type to remove a value.

-- Step 1: change replies.sentiment to text temporarily
ALTER TABLE "replies" ALTER COLUMN "sentiment" TYPE text;--> statement-breakpoint

-- Step 2: reclassify any existing hostile rows to negative
UPDATE "replies" SET "sentiment" = 'negative' WHERE "sentiment" = 'hostile';--> statement-breakpoint
UPDATE "replies" SET "category" = 'negative' WHERE "category" = 'hostile';--> statement-breakpoint

-- Step 3: recreate sentiment enum without 'hostile'
DROP TYPE "public"."sentiment";--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'negative', 'neutral', 'out_of_office');--> statement-breakpoint

-- Step 4: restore replies.sentiment to the new enum type
ALTER TABLE "replies" ALTER COLUMN "sentiment" TYPE "public"."sentiment" USING "sentiment"::"public"."sentiment";--> statement-breakpoint

-- Remove 'hostile' from suppression_reason enum
-- Step 1: change suppression_list.reason to text temporarily
ALTER TABLE "suppression_list" ALTER COLUMN "reason" TYPE text;--> statement-breakpoint

-- Step 2: reclassify any existing hostile rows to manual
UPDATE "suppression_list" SET "reason" = 'manual' WHERE "reason" = 'hostile';--> statement-breakpoint

-- Step 3: recreate suppression_reason enum without 'hostile'
DROP TYPE "public"."suppression_reason";--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribed', 'manual');--> statement-breakpoint

-- Step 4: restore suppression_list.reason to the new enum type
ALTER TABLE "suppression_list" ALTER COLUMN "reason" TYPE "public"."suppression_reason" USING "reason"::"public"."suppression_reason";
