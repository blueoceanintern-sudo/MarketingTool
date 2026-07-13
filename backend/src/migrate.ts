import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";

export async function runMigrations(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql);

  console.log("Starting migration...");
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    console.log("Extensions ready.");

    // Repair stale migration tracking state before letting Drizzle run.
    const [{ trackingExists }] = await sql<[{ trackingExists: boolean }]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS "trackingExists"
    `;

    if (trackingExists) {
      const rows = await sql<{ created_at: string }[]>`
        SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
      `;

      if (rows.length === 0) {
        // Tracking table was wiped. Check if 0000 already ran by looking for the
        // campaign_status enum it creates. If it exists, reinsert the 0000 record
        // so Drizzle's watermark skips it and only runs 0001+.
        const [{ typeExists }] = await sql<[{ typeExists: boolean }]>`
          SELECT EXISTS (
            SELECT FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'campaign_status' AND n.nspname = 'public'
          ) AS "typeExists"
        `;
        if (typeExists) {
          const dir = "./src/db/migrations";
          const file0000 = readdirSync(dir).find(f => /^0000_/.test(f) && f.endsWith(".sql"));
          if (file0000) {
            const content = readFileSync(`${dir}/${file0000}`, "utf-8");
            const hash = createHash("sha256").update(content).digest("hex");
            // Drizzle stores created_at = folderMillis = Number("0000") = 0.
            // Anything with created_at > 0 (i.e., 0001+) will be re-applied.
            await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${0})`;
            console.log("Reinserted 0000 migration record — 0001+ will be applied.");
          }
        }
      } else {
        // Records exist. If geo_places is still missing, the 0001 record is stale
        // (insert happened but table creation failed). Delete everything after 0000
        // so Drizzle re-runs 0001+.
        const [{ geoExists }] = await sql<[{ geoExists: boolean }]>`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'geo_places'
          ) AS "geoExists"
        `;
        if (!geoExists) {
          console.log("geo_places missing — removing stale records after 0000...");
          await sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at > 0`;
        }
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
