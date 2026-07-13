import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createHash } from "crypto";
import { readFileSync } from "fs";

export async function runMigrations(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql);

  console.log("Starting migration...");
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    console.log("Extensions ready.");

    // Check if geo_places exists — if not, migrations are incomplete and the
    // tracking table may be in a broken state (stale or incorrect records).
    const [{ geoExists }] = await sql<[{ geoExists: boolean }]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'geo_places'
      ) AS "geoExists"
    `;

    if (!geoExists) {
      // Wipe the tracking table so we can rebuild from a known state.
      try {
        await sql`DELETE FROM drizzle.__drizzle_migrations`;
        console.log("Cleared stale migration tracking records.");
      } catch {
        // Table may not exist yet on a brand-new database — that's fine.
      }

      // Check whether migration 0000 already applied (campaign_status enum is proof).
      // Drizzle skips based purely on: lastRecord.created_at < migration.folderMillis
      // so we must insert with the real 'when' from _journal.json, not an arbitrary value.
      const [{ campaignStatusExists }] = await sql<[{ campaignStatusExists: boolean }]>`
        SELECT EXISTS (
          SELECT FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'campaign_status' AND n.nspname = 'public'
        ) AS "campaignStatusExists"
      `;

      if (campaignStatusExists) {
        const journalPath = "./src/db/migrations/meta/_journal.json";
        const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
          entries: { idx: number; when: number; tag: string }[];
        };
        const entry0 = journal.entries.find((e) => e.idx === 0)!;
        const content = readFileSync(`./src/db/migrations/${entry0.tag}.sql`).toString();
        const hash = createHash("sha256").update(content).digest("hex");
        await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry0.when})`;
        console.log(`Reinserted 0000 record (when=${entry0.when}) — 0001+ will be applied next.`);
      }
    }

    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    console.log("Migration successful!");

    const applied = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
    console.log("Applied migrations:", JSON.stringify(applied, null, 2));
  } finally {
    await sql.end();
  }
}

// Only execute when run directly (not when imported by index.ts).
if (import.meta.path === Bun.main) {
  await runMigrations().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
  process.exit(0);
}
