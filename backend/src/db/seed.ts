import { readFileSync } from "node:fs";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const seedSql = readFileSync(new URL("./seed.sql", import.meta.url), "utf8");

const sql = postgres(connectionString);
try {
  await sql.unsafe(seedSql);
  console.log("[seed] applied src/db/seed.sql");
} finally {
  await sql.end();
}
