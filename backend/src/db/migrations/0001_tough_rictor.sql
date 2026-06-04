ALTER TYPE "public"."company_size" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "industry" DROP NOT NULL;