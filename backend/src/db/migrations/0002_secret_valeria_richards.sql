ALTER TABLE "directory_configs" ALTER COLUMN "geoname_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_registry" ALTER COLUMN "geoname_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_configs" DROP COLUMN "geo";--> statement-breakpoint
ALTER TABLE "source_registry" DROP COLUMN "geo";