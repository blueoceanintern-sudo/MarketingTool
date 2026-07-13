import { readFileSync } from "node:fs";
import postgres from "postgres";
import { $ } from "bun";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const seedSql = readFileSync(new URL("./test-emails.sql", import.meta.url), "utf8");

const sql = postgres(connectionString);
try {
  await sql.unsafe(seedSql);
  console.log("[seed] applied src/db/test-emails.sql");
} finally {
  await sql.end();
}

// This script can insert new companies (e.g. ACME) independently of
// seed.ts's own backfill call, so it needs its own — idempotent (only
// touches companies rows where geoname_id IS NULL), cheap to re-run.
const backfillCompanyGeoScript = new URL("../scripts/backfill-company-geo.ts", import.meta.url).pathname;
console.log("[seed] running backfill-company-geo.ts --apply");
await $`bun run ${backfillCompanyGeoScript} --apply`;
