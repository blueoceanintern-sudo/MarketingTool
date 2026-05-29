# Automated Marketing Tool — BlueOcean

Internal B2B outreach pipeline: scrapes leads → enriches via Snov.io → AI drafts emails (one per lead per campaign via Claude Haiku, picking from admin-managed prompt templates) → rep reviews/approves → sends via AWS SES → agent monitors replies → routes through decision tree. Target markets: Singapore, Australia, US.

---

## Overview

### Problem
BlueOcean's outreach pipeline is manual, slow, and inconsistent across Singapore, Australia, and the US — resulting in high cost-per-lead and missed revenue. Sales teams spend excessive time on repetitive tasks like lead research and email composition.

### Solution
This internal tool automates the entire B2B outreach pipeline. Staff operate it with zero code changes when switching industries — simply update the source registry to support new verticals and markets.

### Key Features
- **Lead Scraping** — Source leads from industry directories, government registries (ACRA, ASIC, SEC EDGAR), and public company data
- **Lead Enrichment** — Auto-enrich contact data via Snov.io API (Apollo.io fallback)
- **AI Email Drafting** — One personalised email per (lead, campaign) pair via Claude Haiku Batch API. Each draft is generated using one of N admin-managed prompt templates (style variants), picked by weighted-random; engagement is tracked per template so reps can compare which styles land best. Confidence score included in the same generation call
- **Human Review Queue** — Rep-controlled approval for the first 500 emails; auto-send thereafter for high-confidence drafts (score ≥ 70)
- **Reply Automation** — Sentiment-based routing: positive → demo booking, no reply → follow-ups, negative → suppress
- **Analytics Dashboard** — Open rates, reply rates, demo bookings, CAC — filterable by market and vertical

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Hono on Bun (TypeScript) |
| Frontend | Next.js 15, App Router, shadcn/ui, Tailwind CSS v4 |
| Database | PostgreSQL + pgvector, Drizzle ORM |
| Email | AWS SES |
| Scraping | Crawl4AI (Docker) + Cheerio fallback |
| Enrichment | Snov.io (Apollo.io fallback) |
| AI | Claude Haiku 4.5 — Batch API for drafting, prompt caching for classification |
| Hosting | AWS Lightsail |
| Background Jobs | node-cron |

---

## Project Structure

```
MarketingTool/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Hono app entry + route mounting
│   │   ├── config/sourceRegistry.ts    # Scrape target selectors
│   │   ├── db/
│   │   │   ├── index.ts                # Drizzle DB client
│   │   │   └── schema/                 # Table + enum definitions
│   │   ├── routes/                     # API route handlers
│   │   │   ├── campaigns.ts
│   │   │   ├── leads.ts
│   │   │   ├── drafts.ts
│   │   │   ├── replies.ts
│   │   │   ├── analytics.ts
│   │   │   ├── demos.ts
│   │   │   └── admin.ts
│   │   ├── services/
│   │   │   ├── scrapers/               # Crawl4AI + Cheerio
│   │   │   ├── scraping/               # Scrape job orchestration
│   │   │   ├── enrichment/             # Snov.io
│   │   │   ├── drafting/               # Claude Haiku Batch API
│   │   │   └── sender/                 # AWS SES
│   │   └── workers/                    # node-cron jobs
│   ├── tests/
│   ├── .env.example                    # Required env vars — copy to .env
│   └── drizzle.config.ts
├── frontend/
│   └── src/
│       ├── app/                        # Next.js pages
│       │   ├── campaigns/
│       │   ├── drafts/
│       │   ├── leads/
│       │   ├── replies/
│       │   ├── analytics/
│       │   ├── registry/
│       │   └── settings/
│       ├── components/                 # Shared + shadcn/ui components
│       └── lib/                        # API client + utilities
├── stitch/                             # HTML design references
├── docker-compose.yml                  # Crawl4AI service
├── CLAUDE.md                           # AI agent instructions
└── DESIGN.md                           # Design system reference
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- Node.js 18+ (frontend)
- PostgreSQL 15+
- Docker (for Crawl4AI scraper)

### 1. Install dependencies

```bash
# Backend
cd backend && bun install

# Frontend
cd frontend && npm install
```

### 2. Configure environment

```bash
# Backend — copy and fill in your values
cp backend/.env.example backend/.env
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Set up the database

```bash
# Start PostgreSQL (pgvector/pgvector:pg16) from repo root
docker-compose up -d postgres

cd backend
bun run db:generate   # generate migrations from schema (only if schema changed)
bun run db:migrate    # apply migrations to your database
bun run db:seed            # load shared dev fixtures (source_registry rows, etc.)
```

The seed script is idempotent — safe to re-run any time. New fixtures go into
`backend/src/db/seed.sql`.

### 4. Start services

```bash
# Crawl4AI scraper (optional — needed for JS-rendered pages)
docker-compose up crawl4ai

# Backend (port 3001)
cd backend && bun run dev

# Frontend (port 3000)
cd frontend && npm run dev
```

### 5. Install Playwright Chromium (first run only)

The enrichment pipeline drives a headless Chrome via Playwright. Install the
browser binary once per machine:

```bash
cd backend && bunx playwright install chromium
```

On Linux deployment targets also run `bunx playwright install-deps chromium`
to pull in system libraries (fonts, libnss, etc.). Not needed on macOS.

---

## Deployment (AWS Lightsail)

Target: single-instance Lightsail VM, 2GB RAM / 2 vCPUs.

### First-time setup on the VM

```bash
# 1. System deps for Playwright Chromium
sudo apt-get update
cd backend && bunx playwright install-deps chromium
bunx playwright install chromium

# 2. Persistent volume for the enrichment NDJSON
sudo mkdir -p /var/lib/blueocean
sudo chown $USER /var/lib/blueocean
```

Then set `ENRICHED_LEADS_PATH=/var/lib/blueocean/enriched_leads.ndjson` in the
production env so deploys don't truncate the file.

### Secrets

Per `CLAUDE.md` §Security, `.env` is for local dev only. In production, pull
secrets from **AWS Systems Manager Parameter Store** (or Secrets Manager) at
boot. At minimum these must come from Parameter Store, never the repo:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `AWS_SECRET_ACCESS_KEY`,
`SNOVIO_CLIENT_SECRET`.

### Every deploy

```bash
git pull
cd backend && bun install
bun run db:migrate           # apply any new Drizzle migrations
# restart your process manager (systemd / pm2 / etc.)
```

### Email domain hardening (one-time, before first SES send)

Configure SPF + DKIM + DMARC on the sending domain in the AWS SES console
before any cold outreach. Without these, deliverability into SG/AU/US targets
will be poor and the domain is spoofable.

---

## API Routes

All routes prefixed `/api/v1`.

| Method | Route | Description |
|---|---|---|
| POST/GET | `/campaigns` | Create / list campaigns |
| GET/PATCH | `/campaigns/:id` | Get / update campaign status |
| POST/GET | `/campaigns/:id/leads/import` | CSV import / list leads |
| GET | `/drafts/queue` | Review queue |
| PATCH | `/drafts/:id/approve` | Approve draft |
| PATCH | `/drafts/:id/reject` | Reject draft |
| PATCH | `/drafts/:id/edit` | Edit + re-score draft |
| POST | `/webhooks/ses/reply` | Inbound reply webhook |
| GET | `/replies/flagged` | Flagged replies |
| GET | `/analytics/overview` | Pipeline metrics |
| POST/GET | `/demos` | Demo bookings |
| GET/POST | `/registry/sources` | Source registry |
| GET/POST | `/suppression` | Suppression list |

---

## Compliance

- Only scrape publicly listed business contacts
- Respect `robots.txt` on all sources
- Rate limit: 1 req / 2s; back off on 429; pause 24h on CAPTCHA
- Max 500 records per domain per day
- Suppression list checked before every send
- One-click unsubscribe in every email
- Market legal flags: SG → PDPA, AU → Privacy Act, US → CAN-SPAM
- No re-contact within 90 days of prior outreach
