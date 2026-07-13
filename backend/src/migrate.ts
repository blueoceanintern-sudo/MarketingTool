import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

console.log("Starting migration...");
try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  console.log("Extensions ready.");

  // Detect stale migration state: tracking table says migrations ran but tables are missing.
  // This happens when a previous migration attempt failed mid-way and left partial records.
  const [{ exists }] = await sql<[{ exists: boolean }]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'geo_places'
    ) AS exists
  `;
  if (!exists) {
    console.log("geo_places table missing — clearing all stale migration records to force re-apply...");
    try {
      await sql`DELETE FROM drizzle.__drizzle_migrations`;
    } catch {
      // Tracking table may not exist yet — fine, migrate() will create it.
    }
  }

  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migration successful!");

  const applied = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  console.log("Applied migrations:", JSON.stringify(applied, null, 2));
} catch (err) {
  console.error("Migration failed:", err);
  await sql.end();
  process.exit(1);
}

await sql.end();
process.exit(0);
