import { readFileSync } from "node:fs";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const sqlPath = new URL("./seed.sql", import.meta.url);
let seedSql = readFileSync(sqlPath, "utf8");

// Migrate bulk lead INSERTs that still use the old first_name/last_name column layout.
// Matches each old-format INSERT block atomically so transforms don't bleed across blocks.
seedSql = seedSql.replace(
  /INSERT INTO leads \(id, company_id, first_name, last_name, email,[\s\S]*?ON CONFLICT \([^)]+\) DO NOTHING;/g,
  (block) => {
    // Replace the column list: two name columns → one
    let b = block.replace(
      "INSERT INTO leads (id, company_id, first_name, last_name, email,",
      "INSERT INTO leads (id, company_id, name, email,",
    );

    // Replace the two name columns with a single merged name — all four NULL/value
    // combinations handled in one pass so no regex can fire twice on the same row.
    b = b.replace(
      /(\([^)]*?::uuid,\s*)(?:('(?:[^']|'')*'),\s*('(?:[^']|'')*'),|NULL,\s*NULL,|('(?:[^']|'')*'),\s*NULL,|NULL,\s*('(?:[^']|'')*'),)/g,
      (_, prefix, first, last, firstOnly, lastOnly) => {
        if (first !== undefined) {
          const f = first.slice(1, -1).replace(/''/g, "'").trim();
          const l = last.slice(1, -1).replace(/''/g, "'").trim();
          const name = [f, l].filter(Boolean).join(" ").replace(/'/g, "''");
          return `${prefix}'${name}',`;
        }
        if (firstOnly !== undefined) return `${prefix}${firstOnly},`;
        if (lastOnly !== undefined) return `${prefix}${lastOnly},`;
        return `${prefix}NULL,`;
      },
    );

    return b;
  },
);

const sql = postgres(connectionString);
try {
  await sql.unsafe(seedSql);
  console.log("[seed] applied src/db/seed.sql");
} finally {
  await sql.end();
}
