CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"geoname_id" integer,
	"query" text NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_configs" ALTER COLUMN "geoname_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_registry" ALTER COLUMN "geoname_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_registry" ADD COLUMN "quality_score" real;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_geoname_id_geo_places_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."geo_places"("geoname_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_runs_campaign_id_idx" ON "discovery_runs" USING btree ("campaign_id");