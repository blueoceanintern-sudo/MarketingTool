ALTER TABLE "companies" ADD COLUMN "geoname_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_geoname_id_geo_places_geoname_id_fk" FOREIGN KEY ("geoname_id") REFERENCES "public"."geo_places"("geoname_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_geoname_id_idx" ON "companies" USING btree ("geoname_id");