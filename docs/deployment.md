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

AUTH_SECRET=                     # JWT signing secret — required by requireAuth middleware on all /api/v1/* routes.
                                 # Generate a strong random value (e.g. openssl rand -hex 32). Never commit this.

CORS_ORIGINS=https://yourdomain.com  # comma-separated list of allowed CORS origins.
                                     # Defaults to http://localhost:3000 if unset. Set to your public frontend URL in prod.

SNS_TOPIC_ARN=                   # SNS topic forwarding SES inbound to the reply webhook; other topics rejected

SKIP_SNS_VERIFICATION=false      # dev-only — set to 'true' to skip SNS signature verification locally.
                                 # Never set in production.

ENRICHMENT_DAILY_RUN_CAP=200     # enrichment-retry worker cap

NODE_ENV=development             # development | production
PORT=3001
FRONTEND_URL=https://yourdomain.com  # public-facing frontend URL — embedded in List-Unsubscribe headers in every outbound email.
                                     # MUST be set in production. If missing, unsubscribe links default to localhost:3000 and break.
NEXT_PUBLIC_API_URL=http://localhost:3001  # backend URL as seen from the frontend container (localhost works when both run on the same host)

SES_DRY_RUN=false                # set to 'true' to skip the actual SES call and record a fake email_event instead.
                                 # Use this to test the full send pipeline locally without AWS credentials.

MUTATION_NOTIFY_WEBHOOK_URL=     # optional — if set, mutation-runner posts a JSON payload here after each new template
                                 # variant is created. Use for Slack/Discord alerts. Leave blank to disable.

BOOKING_URL=                     # optional — scheduling/booking page link. When set, outbound emails render a
                                 # "Book a time to chat" CTA button (see backend/src/templates/outreachEmail.ts).
                                 # Leave blank to omit the button entirely.
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
bun drizzle-kit generate        # generate a new migration file from schema changes
bun drizzle-kit migrate         # apply pending migrations to the database
bun run db:seed                 # seed prompt_templates (idempotent — safe to re-run)
bun drizzle-kit studio          # open Drizzle Studio in the browser
```

> Migrations live in `backend/src/db/migrations/` and are committed to the repo. Every dev generates and applies them locally against their own database.

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

- **Hosting:** AWS Lightsail — 2GB RAM, 2 vCPU, single instance. The in-memory rate limiter and in-process cron assume a single instance. Deployed via **Coolify** (Docker-based PaaS running on the Lightsail instance).
- **Email:** AWS SES, region `ap-southeast-1`. Domain must have SPF/DKIM/DMARC before first send (see `security.md`).
- **Scraper:** self-hosted Crawl4AI via Docker on port 11235.
- **Encryption:** enable encryption at rest on the PostgreSQL volume; enforce TLS 1.2+ on all external calls.

## Coolify Deployment

The app runs as two separate Docker services managed by Coolify (frontend + backend). Key points:

- **Port exposure:** Only port 80 (frontend / Next.js) is publicly reachable. Port 3001 (backend / Hono) is internal only — the frontend calls the backend via `NEXT_PUBLIC_API_URL=http://localhost:3001` on the same host.
- **Environment variables:** Set all env vars in the Coolify UI under each service's "Environment Variables" tab (Runtime-only, not build-time, for secrets). Do **not** commit `.env` files.
- **`FRONTEND_URL` (backend service):** Must be set to the public URL (e.g. `https://yourdomain.com`). This is embedded in `List-Unsubscribe` headers in every outbound email. Wrong or missing → unsubscribe links break for recipients.
- **`NEXT_PUBLIC_API_URL` (frontend service):** Set to `http://localhost:3001` when frontend and backend share the same host. This is used by the frontend server-side code (e.g. the `/api/unsubscribe` proxy route) to reach the backend internally.
- **Redeployment:** After pushing to `Production` branch, trigger a redeploy in Coolify for each service. The backend container runs `bun run src/db/seed.ts` on start to populate `prompt_templates`.

## Future: Monorepo Commands (not yet wired)

The app will eventually migrate to a monorepo layout (see `roadmap.md`). These commands don't work yet — they're listed here so they aren't forgotten. Until the migration lands, use the per-package commands above.

```bash
bun install
bun run dev                       # start api + web
bun run dev --filter=apps/api     # api only
bun run dev --filter=apps/web     # web only
```
