import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

console.log("Starting migration...");
try {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migration successful!");
} catch (err) {
  console.error("Migration failed:", err);
}
await sql.end();
process.exit(0);
