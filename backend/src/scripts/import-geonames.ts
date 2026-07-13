// One-off/rerunnable import of GeoNames static dump data into geo_places.
// Run with: bun run src/scripts/import-geonames.ts [comma,separated,country,codes]
// With no argument, imports every country GeoNames knows about (~250) plus
// every region and every city with population >= 15000 (or a country
// capital) worldwide — these three files are already a curated, modestly
// sized subset (tens of thousands of rows total), not the full 12M-place
// GeoNames dataset, so there's no real cost to importing globally by
// default. Pass an explicit country-code list only to narrow scope (e.g.
// for a faster test run).
//
// Pulls three static (unauthenticated) files from GeoNames' dump host:
//   - countryInfo.txt        -> one row per country (feature_code "PCLI")
//   - admin1CodesASCII.txt   -> one row per state/province (feature_code "ADM1")
//   - cities15000.zip        -> populated places with population >= 15000
//                               (or the country's capital, regardless of size)
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { and, eq, like, sql } from "drizzle-orm";
import { db, client } from "../db";
import { geoPlaces } from "../db/schema";

const DUMP_HOST = "https://download.geonames.org/export/dump";
const BATCH_SIZE = 500;

// null = no filter, import every country GeoNames has.
type CountryFilter = Set<string> | null;
function matchesFilter(code: string, filter: CountryFilter): boolean {
  return filter === null || filter.has(code);
}

interface GeoPlaceRow {
  geonameId: number;
  name: string;
  asciiName: string;
  countryCode: string;
  admin1Code: string | null;
  admin1Name: string | null;
  featureCode: string;
  population: number | null;
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${DUMP_HOST}/${path}`);
  if (!res.ok) throw new Error(`failed to fetch ${path}: ${res.status}`);
  return res.text();
}

async function fetchCitiesFile(tmpDir: string): Promise<string> {
  const res = await fetch(`${DUMP_HOST}/cities15000.zip`);
  if (!res.ok) throw new Error(`failed to fetch cities15000.zip: ${res.status}`);
  const zipPath = join(tmpDir, "cities15000.zip");
  await Bun.write(zipPath, await res.arrayBuffer());
  await $`unzip -o -q ${zipPath} -d ${tmpDir}`;
  return readFile(join(tmpDir, "cities15000.txt"), "utf8");
}

// countryInfo.txt columns (0-indexed): ISO, ISO3, ISO-Numeric, fips, Country,
// Capital, Area, Population, Continent, tld, CurrencyCode, CurrencyName,
// Phone, Postal Code Format, Postal Code Regex, Languages, geonameid, ...
function parseCountryInfo(raw: string, filter: CountryFilter): GeoPlaceRow[] {
  const rows: GeoPlaceRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    const iso = cols[0];
    const country = cols[4];
    const population = cols[7];
    const geonameId = cols[16];
    if (!iso || !matchesFilter(iso, filter) || !geonameId || !country || !/^\d+$/.test(geonameId)) continue;
    rows.push({
      geonameId: Number(geonameId),
      name: country,
      asciiName: country,
      countryCode: iso,
      admin1Code: null,
      admin1Name: null,
      featureCode: "PCLI",
      population: population && /^\d+$/.test(population) ? Number(population) : null,
    });
  }
  return rows;
}

function parseAdmin1Codes(raw: string, filter: CountryFilter): { rows: GeoPlaceRow[]; nameByCode: Map<string, string> } {
  const rows: GeoPlaceRow[] = [];
  const nameByCode = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [code, name, asciiName, geonameId] = line.split("\t");
    if (!code || !geonameId || !name || !/^\d+$/.test(geonameId)) continue;
    const [countryCode, admin1Code] = code.split(".");
    if (!countryCode || !admin1Code || !matchesFilter(countryCode, filter)) continue;
    nameByCode.set(code, name);
    rows.push({
      geonameId: Number(geonameId),
      name,
      asciiName: asciiName || name,
      countryCode,
      admin1Code,
      admin1Name: name,
      featureCode: "ADM1",
      population: null,
    });
  }
  return { rows, nameByCode };
}

function parseCities(raw: string, filter: CountryFilter, admin1Names: Map<string, string>): GeoPlaceRow[] {
  const rows: GeoPlaceRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    const geonameId = cols[0];
    const name = cols[1];
    const asciiName = cols[2];
    const featureCode = cols[7];
    const countryCode = cols[8];
    const admin1Code = cols[10];
    const population = cols[14];
    if (!geonameId || !name || !featureCode || !countryCode || !matchesFilter(countryCode, filter) || !/^\d+$/.test(geonameId)) continue;
    const admin1Name = admin1Code ? admin1Names.get(`${countryCode}.${admin1Code}`) ?? null : null;
    rows.push({
      geonameId: Number(geonameId),
      name,
      asciiName: asciiName || name,
      countryCode,
      admin1Code: admin1Code || null,
      admin1Name,
      featureCode,
      population: population && /^\d+$/.test(population) ? Number(population) : null,
    });
  }
  return rows;
}

// City-states (Singapore, Monaco, Vatican City, ...) have a capital (PPLC)
// with the exact same name as the country (PCLI) itself — GeoNames lists
// both as distinct rows, which otherwise shows up as two identical-looking
// options in the geo search/combobox. Drop the redundant capital row and
// keep only the country-level entry.
async function removeCountryNameCapitalDuplicates(countryRows: GeoPlaceRow[]): Promise<number> {
  let removed = 0;
  for (const country of countryRows) {
    const deleted = await db
      .delete(geoPlaces)
      .where(
        and(
          eq(geoPlaces.featureCode, "PPLC"),
          eq(geoPlaces.countryCode, country.countryCode),
          sql`lower(${geoPlaces.name}) = lower(${country.name})`,
        ),
      )
      .returning({ geonameId: geoPlaces.geonameId });
    removed += deleted.length;
  }
  return removed;
}

// Same problem one level down: centrally-governed municipalities (Hanoi, Ho
// Chi Minh City, ...) are simultaneously their own first-level administrative
// division (ADM1) and a populated place (PPL*) with the identical name — so
// "Hanoi" would otherwise show up twice. Keep the city row (it carries
// population and a concrete feature code) and drop the redundant ADM1 row.
async function removeAdmin1CityDuplicates(admin1Rows: GeoPlaceRow[]): Promise<number> {
  let removed = 0;
  for (const region of admin1Rows) {
    const [cityMatch] = await db
      .select({ geonameId: geoPlaces.geonameId })
      .from(geoPlaces)
      .where(
        and(
          eq(geoPlaces.countryCode, region.countryCode),
          like(geoPlaces.featureCode, "PPL%"),
          sql`lower(${geoPlaces.name}) = lower(${region.name})`,
        ),
      )
      .limit(1);
    if (!cityMatch) continue;
    const deleted = await db
      .delete(geoPlaces)
      .where(eq(geoPlaces.geonameId, region.geonameId))
      .returning({ geonameId: geoPlaces.geonameId });
    removed += deleted.length;
  }
  return removed;
}

async function upsertGeoPlaces(rows: GeoPlaceRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db
      .insert(geoPlaces)
      .values(batch)
      .onConflictDoUpdate({
        target: geoPlaces.geonameId,
        set: {
          name: sql`excluded.name`,
          asciiName: sql`excluded.ascii_name`,
          countryCode: sql`excluded.country_code`,
          admin1Code: sql`excluded.admin1_code`,
          admin1Name: sql`excluded.admin1_name`,
          featureCode: sql`excluded.feature_code`,
          population: sql`excluded.population`,
        },
      });
  }
}

async function main() {
  const countryArg = process.argv[2];
  const filter: CountryFilter = countryArg
    ? new Set(countryArg.split(",").map((c: string) => c.trim().toUpperCase()))
    : null;
  console.log(`[import-geonames] importing: ${filter ? [...filter].join(", ") : "all countries"}`);

  const tmpDir = await mkdtemp(join(tmpdir(), "geonames-"));
  try {
    const [countryInfoRaw, admin1Raw, citiesRaw] = await Promise.all([
      fetchText("countryInfo.txt"),
      fetchText("admin1CodesASCII.txt"),
      fetchCitiesFile(tmpDir),
    ]);

    const countryRows = parseCountryInfo(countryInfoRaw, filter);
    const { rows: admin1Rows, nameByCode } = parseAdmin1Codes(admin1Raw, filter);
    const cityRows = parseCities(citiesRaw, filter, nameByCode);

    const allRows = [...countryRows, ...admin1Rows, ...cityRows];
    await upsertGeoPlaces(allRows);
    const removedCapitals = await removeCountryNameCapitalDuplicates(countryRows);
    const removedRegions = await removeAdmin1CityDuplicates(admin1Rows);

    console.log(
      `[import-geonames] upserted ${allRows.length} rows ` +
        `(${countryRows.length} countries, ${admin1Rows.length} regions, ${cityRows.length} cities)` +
        (removedCapitals > 0 ? `; removed ${removedCapitals} capital row(s) duplicating their country's name` : "") +
        (removedRegions > 0 ? `; removed ${removedRegions} region row(s) duplicating a city's name` : ""),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    await client.end();
  }
}

await main();
