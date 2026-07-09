import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

console.log("Starting migration...");
try {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migration successful!");
  
  const applied = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  console.log("Applied migrations:", JSON.stringify(applied, null, 2));
} catch (err) {
  console.error("Migration failed:", err);
}

await sql.end();
process.exit(0);
