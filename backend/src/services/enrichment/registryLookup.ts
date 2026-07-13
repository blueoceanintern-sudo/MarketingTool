import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { sourceRegistry, geoPlaces } from "../../db/schema";
import type { EnrichmentInput, EnrichmentProvider, ProviderResult } from "./types";

// Public registry lookup: hits source_registry rows where scraper_type='api'
// matching the lead's market and vertical. Each row's `selectors` JSON maps
// response fields to our schema (e.g. { "name": "school_name", "registration_id": "moe_code" }).
//
// Registries listing the contact email directly produce email_status='verified'.
// Registries that only resolve the institution leave contact for the next provider.
export const registryProvider: EnrichmentProvider = {
  name: "registry",

  async enrich(input: EnrichmentInput): Promise<ProviderResult | null> {
    // market is country-level (SG/AU/US); a source's geoname_id may be a
    // country, region, or city, so match on the resolved country code.
    const rows = await db
      .select({ source: sourceRegistry })
      .from(sourceRegistry)
      .innerJoin(geoPlaces, eq(sourceRegistry.geonameId, geoPlaces.geonameId))
      .where(
        and(
          eq(sourceRegistry.active, true),
          eq(sourceRegistry.scraperType, "api"),
          eq(geoPlaces.countryCode, input.market),
        ),
      );
    const sources = rows.map((r) => r.source);

    for (const source of sources) {
      const result = await tryRegistry(source.url, source.selectors ?? {}, input);
      if (result) return result;
    }

    return null;
  },
};

async function tryRegistry(
  url: string,
  selectors: Record<string, string>,
  input: EnrichmentInput,
): Promise<ProviderResult | null> {
  const query = input.seed.companyName;
  if (!query) return null;

  const endpoint = url.includes("{q}")
    ? url.replace("{q}", encodeURIComponent(query))
    : `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as Record<string, unknown>;
  const record = pickFirstRecord(body);
  if (!record) return null;

  const name = readString(record, selectors.name ?? "name");
  if (!name) return null;

  const email = readString(record, selectors.email ?? "email");

  return {
    source: "registry",
    institution: {
      name,
      type: readString(record, selectors.type ?? "type") ?? "unknown",
      registration_id: readString(record, selectors.registration_id ?? "registration_id"),
      size: "unknown",
      website: readString(record, selectors.website ?? "website"),
      region: input.market,
    },
    contact: email
      ? {
          email,
          email_status: "verified",
          full_name: readString(record, selectors.full_name ?? "full_name"),
          first_name: readString(record, selectors.first_name ?? "first_name"),
          role: readString(record, selectors.role ?? "role"),
        }
      : undefined,
  };
}

function pickFirstRecord(body: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(body)) return (body[0] as Record<string, unknown>) ?? null;
  for (const key of ["results", "data", "records", "items"]) {
    const v = body[key];
    if (Array.isArray(v) && v.length > 0) return v[0] as Record<string, unknown>;
  }
  return body;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
