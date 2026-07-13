CREATE TABLE "campaign_geos" (
	"campaign_id" uuid NOT NULL,
	"geoname_id" integer NOT NULL,
	CONSTRAINT "campaign_geos_campaign_id_geoname_id_pk" PRIMARY KEY("campaign_id","geoname_id")
);
--> statement-breakpoint
CREATE TABLE "geo_places" (
	"geoname_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ascii_name" text NOT NULL,
	"country_code" text NOT NULL,
	"admin1_code" text,
	"admin1_name" text,
	"feature_code" text NOT NULL,
	"population" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_configs" DROP CONSTRAINT "directory_configs_vertical_geo_unique";--> statement-breakpoint
ALTER TABLE "directory_configs" ALTER COLUMN "geo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_registry" ALTER COLUMN "geo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_configs" ADD COLUMN "geoname_id" integer;--> statement-breakpoint
ALTER TABLE "source_registry" ADD COLUMN "geoname_id" integer;--> statement-breakpoint
ALTER TABLE "campaign_geos" ADD CONSTRAINT "campaign_geos_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_geos" ADD CONSTRAINT "campaign_geos_geoname_id_geo_places_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."geo_places"("geoname_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_geos_geoname_id_idx" ON "campaign_geos" USING btree ("geoname_id");--> statement-breakpoint
CREATE INDEX "geo_places_country_code_idx" ON "geo_places" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "geo_places_name_trgm_idx" ON "geo_places" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "directory_configs" ADD CONSTRAINT "directory_configs_geoname_id_geo_places_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."geo_places"("geoname_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_registry" ADD CONSTRAINT "source_registry_geoname_id_geo_places_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."geo_places"("geoname_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "geography";--> statement-breakpoint
ALTER TABLE "directory_configs" ADD CONSTRAINT "directory_configs_vertical_geoname_id_unique" UNIQUE("vertical","geoname_id");