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
- **Lead Enrichment** — Auto-enrich contact data through a chain: government registry lookup → Cowork (Playwright-driven) → Snov.io
- **AI Email Drafting** — One personalised email per (lead, campaign) pair via Claude Haiku 4.5. Templates are selected by Thompson Sampling (favours proven performers, still explores new ones). Drafts are scored by a separate adversarial scoring call. Follow-up content uses the true Batch API for cost efficiency.
- **Human Review Queue** — All drafts require rep approval (approve / reject / edit). Reps can also trigger a manual send per-draft from the Scheduled tab. Auto-scheduling for high-confidence drafts is designed but not yet wired.
- **Reply Automation** — Sentiment-based routing: positive → demo booking, no reply → follow-ups, negative → suppress
- **Analytics Dashboard** — Open rates, reply rates, demo bookings, CAC — filterable by market and vertical

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Hono on Bun (TypeScript) |
| Frontend | Next.js 15, App Router, shadcn/ui, Tailwind CSS v4 |
| Database | PostgreSQL + pgvector, Drizzle ORM |
| Email | AWS SES (`SendRawEmailCommand` — raw MIME with `List-Unsubscribe` headers) |
| Scraping | Crawl4AI (Docker) + Cheerio fallback |
| Enrichment | Registry → Cowork → Snov.io chain |
| AI | Claude Haiku 4.5 — Batch API for follow-up content; parallel `messages.create` for initial drafts, scoring, and reply classification |
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

Add to `backend/.env`:
```
# Public-facing frontend URL — embedded in List-Unsubscribe headers in every outbound email.
# MUST be set correctly in production (e.g. https://yourdomain.com).
# If missing, unsubscribe links in emails will default to localhost:3000 and break for recipients.
FRONTEND_URL=http://localhost:3000
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

## AWS Setup (from scratch)

Complete setup sequence for a new AWS account. Do these once before first deploy.

---

### 1. IAM — create a service user

1. Go to **IAM → Users → Create user**. Name it `blueocean-app`.
2. Attach these managed policies directly:
   - `AmazonSESFullAccess`
   - `AmazonSNSFullAccess`
   - `AmazonSSMReadOnlyAccess` (for reading secrets from Parameter Store)
3. Go to **Security credentials → Create access key**. Select "Application running outside AWS". Save the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — you won't see the secret again.

> In production, prefer an **IAM Role** attached to the Lightsail instance over a long-lived access key.

---

### 2. SES — verify your sending domain

1. Go to **SES → Verified identities → Create identity**. Choose **Domain**. Enter your domain (e.g. `yourdomain.com`).
2. SES will show you CNAME records. Add them to your DNS provider. Wait for status to show **Verified** (up to 48h).
3. While there, enable **Easy DKIM** (2048-bit). SES generates three CNAME records — add those too.
4. Add an **SPF** TXT record to your DNS:
   ```
   v=spf1 include:amazonses.com ~all
   ```
5. Add a **DMARC** TXT record at `_dmarc.yourdomain.com`:
   ```
   v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com
   ```

> Without SPF + DKIM + DMARC, cold outreach to SG/AU/US targets will land in spam.

---

### 3. SES — exit the sandbox

New SES accounts are sandboxed (can only send to verified addresses). Request production access:

1. **SES → Account dashboard → Request production access**.
2. Describe your use case (B2B cold outreach, opt-out in every email, suppression list maintained).
3. AWS typically responds within 24h.

---

### 4. SES — configure inbound email receipt

This is what routes replies back to the app.

1. Go to **SES → Email receiving → Rule sets → Create rule set**. Name it `blueocean-inbound`. Set it as active.
2. Inside the rule set, **Create rule**:
   - **Recipient condition**: `outreach@yourdomain.com` (your `AWS_SES_FROM_ADDRESS`)
   - **Action**: **Publish to Amazon SNS topic** (create a new topic in the next step, then come back)
3. Under **SES → Verified identities → your domain → Email receiving**, enable inbound by adding an MX record to your DNS:
   ```
   10  inbound-smtp.<AWS_REGION>.amazonaws.com
   ```
   e.g. `10  inbound-smtp.ap-southeast-1.amazonaws.com`

---

### 5. SNS — create the inbound topic and subscribe the webhook

1. Go to **SNS → Topics → Create topic**. Type: **Standard**. Name: `ses-inbound-replies`.
2. Note the **ARN** — this is your `SNS_TOPIC_ARN` env var (e.g. `arn:aws:sns:ap-southeast-1:123456789:ses-inbound-replies`).
3. Go back to step 4 and select this topic as the SES receipt rule action.
4. **Create subscription** on the topic:
   - Protocol: **HTTPS**
   - Endpoint: `https://yourdomain.com/api/v1/webhooks/ses/reply`
5. SNS will POST a `SubscriptionConfirmation` message to that URL. The webhook handles this automatically — check your backend logs to confirm it was confirmed.
6. **Upgrade SignatureVersion to 2**: on the topic, go to **Edit → Delivery retry policy** and set `SignatureVersion` to `2` (SHA256). This is the AWS-recommended setting.

---

### 6. AWS Systems Manager — store production secrets

Never store secrets in `.env` on the server. Use Parameter Store:

1. Go to **Systems Manager → Parameter Store → Create parameter** for each secret:

   | Parameter name | Value |
   |---|---|
   | `/blueocean/DATABASE_URL` | `postgresql://...` |
   | `/blueocean/ANTHROPIC_API_KEY` | `sk-ant-...` |
   | `/blueocean/AWS_SECRET_ACCESS_KEY` | from step 1 |
   | `/blueocean/SNOVIO_CLIENT_SECRET` | from Snov.io dashboard |
   | `/blueocean/SNS_TOPIC_ARN` | from step 5 |

2. Use type **SecureString** (KMS-encrypted) for all secrets.
3. At server startup, pull these into the process environment before the app boots. A simple loader script:
   ```bash
   aws ssm get-parameters-by-path --path /blueocean --with-decryption \
     --query "Parameters[*].[Name,Value]" --output text \
     | awk '{gsub("/blueocean/","",$1); print $1"="$2}' > /etc/blueocean.env
   ```
   Then `source /etc/blueocean.env` before running the app.

---

### 7. Lightsail — create the instance

1. Go to **Lightsail → Create instance**. Choose:
   - Platform: **Linux/Unix**
   - Blueprint: **Ubuntu 22.04 LTS**
   - Instance plan: **2 GB RAM / 2 vCPUs** (minimum recommended)
2. Attach a **static IP** to the instance.
3. Open ports in the Lightsail firewall: **443 (HTTPS)**, **80 (HTTP)**, **22 (SSH)**.
4. Point your domain's A record to the static IP.
5. Install a TLS certificate (Let's Encrypt via `certbot`) so the SNS subscription endpoint is HTTPS — SNS will not subscribe to plain HTTP.

---

### 8. RDS / Lightsail Managed Database (optional)

If you want a managed PostgreSQL instead of running it on the same instance:

1. **Lightsail → Databases → Create database**. Choose PostgreSQL 15, 1 GB RAM plan minimum.
2. Enable **Automatic backups** (7-day retention).
3. Set `DATABASE_URL` to the connection string with `sslmode=require`.
4. The app instance and database must be in the **same Lightsail region** to use the private endpoint.

---

## Email Deliverability

All emails are sent as raw MIME via `SendRawEmailCommand` and include:

- `List-Unsubscribe` — required by Gmail and Yahoo for all bulk senders since February 2024
- `List-Unsubscribe-Post` — enables RFC 8058 one-click unsubscribe (Gmail shows an "Unsubscribe" button; clicking it sends a silent POST to the unsubscribe URL)

Unsubscribe links point to `{FRONTEND_URL}/api/unsubscribe` (the Next.js proxy route), **not** the backend directly — port 3001 is firewalled externally. The frontend proxies to `localhost:3001/unsubscribe` server-side, then redirects the browser to `/unsubscribe.html`.

> `FRONTEND_URL` in the **backend** environment must be set to your public domain (e.g. `https://yourdomain.com`). Wrong or missing → links in sent emails will be broken.

---

## Deployment (AWS Lightsail via Coolify)

Target: single-instance Lightsail VM, 2GB RAM / 2 vCPUs, managed by **Coolify** (Docker-based PaaS).

**Port exposure:** Only port 80 (Next.js frontend) is publicly reachable. Port 3001 (Hono backend) is internal. The frontend calls the backend via `NEXT_PUBLIC_API_URL=http://localhost:3001` on the same host.

**Environment variables:** Set all env vars in the Coolify UI under each service's "Environment Variables" tab (Runtime-only for secrets). Do not commit `.env` files.

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

### Process separation (production)

In production the HTTP server and background workers must run as **separate processes** so their Postgres connection pools don't compete and cron activity can't delay HTTP responses.

`src/index.ts` currently imports `"./workers"` for dev convenience. Before deploying, remove that import and manage two processes with your process manager:

```bash
# Process 1 — HTTP server
bun run src/index.ts

# Process 2 — background workers (cron jobs)
bun run workers
```

Both processes will open independent Postgres connection pools. If Process 2 crashes, the HTTP server keeps serving normally, and vice versa.

> **TODO before first production deploy:** remove `import "./workers"` from `src/index.ts`.

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
| POST | `/drafts/:id/send` | Manually send a scheduled draft (runs all hard gates) |
| GET/POST | `/api/unsubscribe` *(frontend)* | Public unsubscribe proxy — linked from every email; GET redirects to confirmation page, POST handles Gmail RFC 8058 one-click |
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
- Suppression list checked before every send — suppressed leads are never re-contacted
