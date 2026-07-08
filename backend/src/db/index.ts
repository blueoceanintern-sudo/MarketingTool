import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

// Exported so the job-event bus can use LISTEN/NOTIFY on a dedicated connection.
export const client = postgres(connectionString);
export const db = drizzle(client, { schema });
