import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { geoPlaces } from "../../db/schema";

export const lookupGeoTool = createTool({
  id: "lookup_geo",
  description:
    "Search for geographic locations by name and return their geonameId. Call once per location mentioned in the brief. Prefer country-level (featureCode PCLI) results for country names.",
  inputSchema: z.object({
    query: z.string().describe("Location name to search for, e.g. 'Australia', 'Singapore', 'New South Wales'"),
  }),
  execute: async ({ query }) => {
    const rows = await db
      .select({
        geonameId: geoPlaces.geonameId,
        name: geoPlaces.name,
        countryCode: geoPlaces.countryCode,
        admin1Name: geoPlaces.admin1Name,
        featureCode: geoPlaces.featureCode,
        population: geoPlaces.population,
      })
      .from(geoPlaces)
      .where(sql`${geoPlaces.name} % ${query}`)
      .orderBy(desc(geoPlaces.population))
      .limit(5);

    return { places: rows };
  },
});
