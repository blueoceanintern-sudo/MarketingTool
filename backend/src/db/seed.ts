import { readFileSync } from "node:fs";
import postgres from "postgres";
import { $ } from "bun";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const seedSql = readFileSync(new URL("./seed.sql", import.meta.url), "utf8");

// import-geonames.ts and backfill-company-geo.ts each own their own DB
// connection lifecycle (they close it on exit), so they're run as separate
// processes rather than imported in-process here.
const importGeonamesScript = new URL("../scripts/import-geonames.ts", import.meta.url).pathname;
const backfillCompanyGeoScript = new URL("../scripts/backfill-company-geo.ts", import.meta.url).pathname;

const sql = postgres(connectionString);
try {
  // geo_places is reference data (GeoNames dump) — seed.sql's directory_configs
  // insert depends on it being populated first, and the companies.geonameId
  // backfill below needs it too. Only fetches over the network on a genuinely
  // empty table, so repeat container boots don't pay for a re-fetch or
  // depend on GeoNames' host being reachable. Run `bun run db:import-geonames`
  // manually to force a refresh.
  const geoPlacesRows = await sql<{ count: number }[]>`SELECT count(*)::int FROM geo_places`;
  const geoPlacesCount = geoPlacesRows[0]?.count ?? 0;
  if (geoPlacesCount === 0) {
    console.log("[seed] geo_places is empty — running import-geonames.ts");
    await $`bun run ${importGeonamesScript}`;
  } else {
    console.log(`[seed] geo_places already has ${geoPlacesCount} rows — skipping import-geonames.ts`);
  }

  await sql.unsafe(seedSql);
  console.log("[seed] applied src/db/seed.sql");
} finally {
  await sql.end();
}

// Idempotent (only touches companies rows where geoname_id IS NULL) — cheap
// to run every time, and self-heals any companies inserted since the last run.
console.log("[seed] running backfill-company-geo.ts --apply");
await $`bun run ${backfillCompanyGeoScript} --apply`;
