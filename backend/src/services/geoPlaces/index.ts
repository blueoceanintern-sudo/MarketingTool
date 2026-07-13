import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { geoPlaces } from "../../db/schema";

export interface GeoPlace {
  geonameId: number;
  name: string;
  asciiName: string;
  countryCode: string;
  admin1Code: string | null;
  admin1Name: string | null;
  featureCode: string;
  population: number | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function searchGeoPlaces(
  query: string,
  opts: { countryCode?: string; limit?: number } = {},
): Promise<GeoPlace[]> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const term = query.trim();

  const rows = await db
    .select()
    .from(geoPlaces)
    .where(
      and(
        term ? or(ilike(geoPlaces.name, `%${term}%`), ilike(geoPlaces.asciiName, `%${term}%`)) : undefined,
        opts.countryCode ? eq(geoPlaces.countryCode, opts.countryCode.trim().toUpperCase()) : undefined,
      ),
    )
    .orderBy(sql`${geoPlaces.population} DESC NULLS LAST`, geoPlaces.name)
    .limit(limit);

  return rows;
}

export async function getGeoPlace(geonameId: number): Promise<GeoPlace | null> {
  const [row] = await db.select().from(geoPlaces).where(eq(geoPlaces.geonameId, geonameId)).limit(1);
  return row ?? null;
}

export async function getGeoPlaces(geonameIds: number[]): Promise<GeoPlace[]> {
  if (geonameIds.length === 0) return [];
  return db.select().from(geoPlaces).where(inArray(geoPlaces.geonameId, geonameIds));
}
