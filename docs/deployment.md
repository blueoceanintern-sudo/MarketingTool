# Deployment & Local Development

Environment variables, local commands, Docker, and infrastructure notes.

## Environment Variables

Never hardcode. Never commit `.env` (`.env*` is gitignored at repo root). In production, pull secrets from AWS Secrets Manager or Parameter Store (see `security.md`).

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/blueocean   # use sslmode=require in prod

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-1
AWS_SES_FROM_ADDRESS=outreach@yourdomain.com

ANTHROPIC_API_KEY=

SNOVIO_CLIENT_ID=
SNOVIO_CLIENT_SECRET=
COWORK_API_KEY=                  # Cowork enrichment provider
COWORK_DAILY_RUN_CAP=            # cap on Cowork enrichment runs/day

TAVILY_API_KEY=                  # dynamic source-registry URL generation

CRAWL4AI_BASE_URL=http://localhost:11235

SECRET_API_KEY=                  # internal API auth — required on all /api/v1/* routes

SNS_TOPIC_ARN=                   # SNS topic forwarding SES inbound to the reply webhook; other topics rejected

ENRICHMENT_DAILY_RUN_CAP=200     # enrichment-retry worker cap

NODE_ENV=development             # development | production
PORT=3001
API_BASE_URL=https://api.yourdomain.com  # public-facing backend URL embedded in email unsubscribe links — MUST be set in production
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Local Development (current layout)

Start the backend first, then the frontend.

**Backend** (`backend/`):

```bash
cd backend
bun install
bun run src/index.ts   # hot reload
```

**Frontend** (`frontend/`):

```bash
cd frontend
npm install
npm run dev      # localhost:3000
npm run build
npm run lint
```

## Database (Drizzle)

```bash
bun drizzle-kit generate   # generate migration from schema
bun drizzle-kit migrate    # apply migrations
bun drizzle-kit studio     # Drizzle Studio
```

> Migrations are generated and applied; every dev runs them locally against their own database. `db/migrations/` is committed to the repo.

## Scraper (Docker)

```bash
docker-compose up crawl4ai             # Crawl4AI on port 11235
docker-compose down
docker-compose up --build crawl4ai     # rebuild after config changes
```

## Workers

```bash
bun run workers   # start all cron jobs (see workers.md)
```

In production, run workers as a **separate process** from the API (see `workers.md` § Process Separation).

## Tests

```bash
bun test
bun test --watch
bun test services/scoring
```

## Infrastructure

- **Hosting:** AWS Lightsail — 2GB RAM, 2 vCPU, single instance. The in-memory rate limiter and in-process cron assume a single instance.
- **Email:** AWS SES, region `ap-southeast-1`. Domain must have SPF/DKIM/DMARC before first send (see `security.md`).
- **Scraper:** self-hosted Crawl4AI via Docker on port 11235.
- **Encryption:** enable encryption at rest on the PostgreSQL volume; enforce TLS 1.2+ on all external calls.

## Target Monorepo Commands (not yet wired)

These will work once the monorepo migration lands (see `roadmap.md`):

```bash
bun install
bun run dev                       # start api + web
bun run dev --filter=apps/api     # api only
bun run dev --filter=apps/web     # web only
```

Until then, use the per-package commands above.
