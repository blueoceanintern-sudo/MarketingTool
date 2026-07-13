// One-off/rerunnable backfill of companies.geonameId from the legacy
// free-text companies.location column. Idempotent — only touches rows where
// geoname_id IS NULL, so it's safe to re-run after fixing unresolved rows
// (e.g. after a geo_places import) or after new legacy-shaped rows appear.
//
// companies.location holds at least 3 different shapes today (see
// docs/database.md and the companies-geoname-migration project memory):
//   - bare country code, e.g. "SG"          (older scraper writes)
//   - "City, CC", e.g. "Melbourne, AU"      (test fixtures / newer writes)
//   - "CITY, ST", e.g. "CAYUGA, TX"         (NCES bulk seed, US state)
//   - bare place name, e.g. "Singapore"     (no comma, no country code)
//
// Matching is deliberately conservative: every candidate query must return
// exactly one row to count as a confident match. 0 or >1 results leaves
// geoname_id null and logs the row for manual review — we never guess.
//
// The "City, XX" shape resolves through a fallback chain, each step coarser
// (but still a true statement) than the last, rather than giving up the
// moment the exact city is missing from geo_places (which only imports
// cities with population >= 15000 — most small towns aren't in there):
//   1. city + country (XX is a real ISO country code)              -> city
//   2. city + region  (XX is a real admin1 code, any country)      -> city
//   3. region alone   (XX matches exactly one admin1 record)       -> region
//   4. country alone  (XX is a real ISO country code, city unused) -> country
// Step 2 isn't hardcoded to the US — GeoNames assigns admin1_code to every
// country's regions, so this applies wherever a 2-letter region code happens
// to be unambiguous (verified for US postal codes; falls through safely via
// the 0-or->1 rule for any country where it isn't).
//
// Run with: bun run src/scripts/backfill-company-geo.ts        (dry run, default)
//           bun run src/scripts/backfill-company-geo.ts --apply (writes geoname_id)
import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { db, client } from "../db";
import { companies, geoPlaces } from "../db/schema";

type InputShape = "bare_country_code" | "city_2letter_suffix" | "bare_name" | "unrecognized";
type MatchShape = "bare_country_code" | "city_country" | "city_region" | "region_fallback" | "country_fallback" | "bare_name";

interface Resolution {
  geonameId: number;
  shape: MatchShape;
}

const BARE_CODE_RE = /^[A-Za-z]{2}$/;
const CITY_CODE_RE = /^(.+),\s*([A-Za-z]{2})$/;

async function resolveBareCountryCode(code: string): Promise<number | null> {
  const rows = await db
    .select({ geonameId: geoPlaces.geonameId })
    .from(geoPlaces)
    .where(and(eq(geoPlaces.countryCode, code.toUpperCase()), eq(geoPlaces.featureCode, "PCLI")));
  return rows.length === 1 ? rows[0]!.geonameId : null;
}

async function resolveCityCountry(city: string, countryCode: string): Promise<number | null> {
  const rows = await db
    .select({ geonameId: geoPlaces.geonameId })
    .from(geoPlaces)
    .where(and(ilike(geoPlaces.name, city), eq(geoPlaces.countryCode, countryCode.toUpperCase())))
    .orderBy(sql`${geoPlaces.population} DESC NULLS LAST`)
    .limit(2);
  return rows.length === 1 ? rows[0]!.geonameId : null;
}

// Not scoped to a country — GeoNames admin1_code is assigned per-country, so
// this matches any country whose region code happens to equal `code` (e.g.
// US postal abbreviations). Cross-country collisions are caught by the
// exactly-one-row rule, same as every other resolver here.
async function resolveCityRegion(city: string, code: string): Promise<number | null> {
  const rows = await db
    .select({ geonameId: geoPlaces.geonameId })
    .from(geoPlaces)
    .where(and(ilike(geoPlaces.name, city), eq(geoPlaces.admin1Code, code.toUpperCase())))
    .orderBy(sql`${geoPlaces.population} DESC NULLS LAST`)
    .limit(2);
  return rows.length === 1 ? rows[0]!.geonameId : null;
}

// Region-only fallback for when the city itself isn't in geo_places (small
// towns below the population-15000 import floor) but its region is — a
// coarser match, but still a true one.
async function resolveRegionOnly(code: string): Promise<number | null> {
  const rows = await db
    .select({ geonameId: geoPlaces.geonameId })
    .from(geoPlaces)
    .where(and(eq(geoPlaces.admin1Code, code.toUpperCase()), eq(geoPlaces.featureCode, "ADM1")))
    .limit(2);
  return rows.length === 1 ? rows[0]!.geonameId : null;
}

async function resolveBareName(value: string): Promise<number | null> {
  const rows = await db
    .select({ geonameId: geoPlaces.geonameId })
    .from(geoPlaces)
    .where(ilike(geoPlaces.name, value))
    .orderBy(sql`${geoPlaces.population} DESC NULLS LAST`)
    .limit(2);
  return rows.length === 1 ? rows[0]!.geonameId : null;
}

// Resolves a legacy location string against geo_places, trying shapes in
// priority order. Returns null (with no further fallback) if the matched
// shape's query doesn't return exactly one confident row.
async function resolveLocation(raw: string): Promise<Resolution | null> {
  const value = raw.trim();
  if (!value) return null;

  if (BARE_CODE_RE.test(value)) {
    const geonameId = await resolveBareCountryCode(value);
    return geonameId ? { geonameId, shape: "bare_country_code" } : null;
  }

  const cityMatch = CITY_CODE_RE.exec(value);
  if (cityMatch) {
    const city = cityMatch[1]!.trim();
    const code = cityMatch[2]!.trim();

    const countryGeonameId = await resolveCityCountry(city, code);
    if (countryGeonameId) return { geonameId: countryGeonameId, shape: "city_country" };

    const regionGeonameId = await resolveCityRegion(city, code);
    if (regionGeonameId) return { geonameId: regionGeonameId, shape: "city_region" };

    const regionOnlyGeonameId = await resolveRegionOnly(code);
    if (regionOnlyGeonameId) return { geonameId: regionOnlyGeonameId, shape: "region_fallback" };

    const countryOnlyGeonameId = await resolveBareCountryCode(code);
    if (countryOnlyGeonameId) return { geonameId: countryOnlyGeonameId, shape: "country_fallback" };

    return null;
  }

  const geonameId = await resolveBareName(value);
  return geonameId ? { geonameId, shape: "bare_name" } : null;
}

function detectShape(raw: string): InputShape {
  const value = raw.trim();
  if (BARE_CODE_RE.test(value)) return "bare_country_code";
  if (CITY_CODE_RE.test(value)) return "city_2letter_suffix"; // resolves via city_country or city_us_state — see resolveLocation
  if (value) return "bare_name";
  return "unrecognized";
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[backfill-company-geo] mode=${apply ? "apply" : "dry-run"}`);

  try {
    const rows = await db
      .select({ id: companies.id, location: companies.location })
      .from(companies)
      .where(isNull(companies.geonameId));

    console.log(`[backfill-company-geo] ${rows.length} companies with geoname_id IS NULL`);

    // "City, XX" is one detected input shape but resolves via one of two
    // different queries (country vs US state) — track matches by the
    // resolution's actual shape so the report distinguishes them, and fall
    // back to the detected input shape for rows that never resolved.
    const shapeTotals = new Map<InputShape, number>();
    const shapeMatched = new Map<MatchShape, number>();
    const unresolved: { id: string; location: string; shape: InputShape }[] = [];
    let updated = 0;

    for (const row of rows) {
      const detected = detectShape(row.location);
      shapeTotals.set(detected, (shapeTotals.get(detected) ?? 0) + 1);

      const resolution = await resolveLocation(row.location);
      if (!resolution) {
        unresolved.push({ id: row.id, location: row.location, shape: detected });
        continue;
      }

      shapeMatched.set(resolution.shape, (shapeMatched.get(resolution.shape) ?? 0) + 1);

      if (apply) {
        await db.update(companies).set({ geonameId: resolution.geonameId }).where(eq(companies.id, row.id));
        updated++;
      }
    }

    console.log(`\n[backfill-company-geo] input shape totals:`);
    for (const [shape, total] of shapeTotals) console.log(`  ${shape}: ${total}`);

    console.log(`\n[backfill-company-geo] matched via:`);
    for (const [shape, matched] of shapeMatched) console.log(`  ${shape}: ${matched}`);

    console.log(`\n[backfill-company-geo] ${apply ? "updated" : "would update"} ${apply ? updated : rows.length - unresolved.length}/${rows.length} rows`);

    if (unresolved.length > 0) {
      console.log(`\n[backfill-company-geo] ${unresolved.length} unresolved rows (left null, manual review):`);
      for (const u of unresolved.slice(0, 50)) {
        console.log(`  ${u.id}  shape=${u.shape}  location=${JSON.stringify(u.location)}`);
      }
      if (unresolved.length > 50) console.log(`  ... and ${unresolved.length - 50} more`);
    }

    if (!apply) {
      console.log(`\n[backfill-company-geo] dry run only — re-run with --apply to write geoname_id`);
    }
  } finally {
    await client.end();
  }
}

await main();
