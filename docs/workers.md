# Workers

All background processing runs through **node-cron** (no Redis/Bull/external queue). Defined in `backend/src/workers/index.ts`. Start with `bun run workers` (target command; today they are imported by `backend/src/index.ts` for dev convenience — see the production note below).

There are **6 workers**.

| Worker | Schedule | What it does |
|---|---|---|
| `drafting-runner` | Every 30 min | Walks eligible `campaign_leads → leads` and generates drafts via the drafting service |
| `follow-up-sender` | Daily 9am | Phase A: sends `scheduled` drafts not yet in `email_events`, creating `follow_ups` rows on success. Phase B: lazily generates follow-up content via Batch API and sends attempts 1–3 for no-reply leads |
| `enrichment-retry` | Daily 3am | Retries unenriched leads and `not_found` leads older than 7 days; calls `enrichLead()` via the orchestrator; capped by `ENRICHMENT_DAILY_RUN_CAP` (default 200) |
| `scrape-retry` | Daily 4am | Retries failed `scrape_jobs` still under `max_retries` |
| `warmup-tracker` | Daily midnight | Tracks warm-up phase + daily send cap (counts only successful SES sends) |
| `purge-old-records` | Weekly, Sunday 2am | Hard-deletes old records per the retention policy; logs purge counts to `audit_log` |

## Retry Behavior

- **Scraping:** `scrape-retry` increments `scrape_jobs.retry_count` on failure and stops once `max_retries` is reached. Jobs blocked by CAPTCHA (`status = blocked`) are skipped for 24h.
- **Enrichment:** `enrichment-retry` reprocesses unenriched or stale `not_found` leads (older than 7 days) through the registry → Cowork → Snov.io chain, bounded by `ENRICHMENT_DAILY_RUN_CAP`.

## Purge Behavior

`purge-old-records` enforces the retention policy in `security.md`. Hard-deletes: `replies > 180d`, `email_events > 365d`, failed/complete `scrape_jobs > 30d`, and `risk_flags > 90d` (after lead suppressed). `suppression_list` and `audit_log` are kept indefinitely. Purge counts are logged to `audit_log`.

## Follow-up Processing Flow

The two-phase logic of `follow-up-sender` (initial send + lazy follow-up content generation, attempt-aware prompts, sequencing, the +3/+7/+14-day cadence, and reply short-circuiting) is documented in detail in `email-system.md` § Follow-up Behavior. This file owns only the schedule and operational notes.

## Production Note: Process Separation

In `backend/src/index.ts`, workers are currently imported (`import "./workers"`) so they run in-process during development. **Before a production deploy, remove that import and run the workers as a separate process** (`bun run workers`) so the API and the cron loop scale and fail independently.
