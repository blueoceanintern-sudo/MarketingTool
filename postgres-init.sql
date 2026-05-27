-- Runs once on first Postgres startup (mounted into
-- /docker-entrypoint-initdb.d/ by docker-compose.yml). Keeps the pgvector
-- extension available before any Drizzle migration runs, so generated
-- migrations don't need to ship a CREATE EXTENSION statement.
CREATE EXTENSION IF NOT EXISTS vector;
