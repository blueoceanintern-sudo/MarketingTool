# Workers

All background processing runs through **node-cron** (no Redis, no Bull, no external queue). Six workers are defined in `backend/src/workers/index.ts`.

**Dev:** Workers are imported directly by `backend/src/index.ts` so they start alongside the API server. **Production:** Remove that import and run them as a separate process (see Production Note below) — this keeps the API and cron loops from competing for the same Postgres connections.

There are **7 workers**.

| Worker | Schedule | What it does |
|---|---|---|
| `drafting-runner` | Every 30 min | Walks `campaign_leads` for active campaigns, generates drafts for eligible leads via parallel direct API calls (not Batch API) |
| `follow-up-sender` | Daily 9am | Phase A: sends `scheduled` drafts not yet in `email_events`, creating `follow_ups` rows on success. Phase B: lazily generates follow-up content via Batch API and sends attempts 1–3 for no-reply leads |
| `enrichment-retry` | Daily 3am | Retries unenriched or stale `not_found` scraped leads (CSV-imported leads are skipped); capped by `ENRICHMENT_DAILY_RUN_CAP` (default 200) |
| `scrape-retry` | Daily 4am | Retries failed `scrape_jobs` still under `max_retries` |
| `warmup-tracker` | Daily midnight | Logs current warm-up week and daily send cap (counts only successful SES sends) |
| `purge-old-records` | Weekly, Sunday 2am | Hard-deletes old records per the retention policy; logs purge counts to the console (does not write to `audit_log`) |
| `mutation-runner` | Weekly, Monday 6am | Auto-generates new template variants via Claude once 300+ total sends exist; see below |

## Retry Behavior

- **Scraping:** `scrape-retry` increments `scrape_jobs.retry_count` on failure and stops once `max_retries` is reached. Jobs blocked by CAPTCHA (`status = blocked`) are skipped for 24h.
- **Enrichment:** `enrichment-retry` reprocesses unenriched or stale `not_found` leads (older than 7 days) through the registry → Cowork → Snov.io chain, bounded by `ENRICHMENT_DAILY_RUN_CAP`.

## Purge Behavior

`purge-old-records` enforces the retention policy in `security.md`. Hard-deletes: `replies > 180d`, `email_events > 365d`, and failed/complete `scrape_jobs > 30d`. `suppression_list` and `audit_log` are kept indefinitely. Purge activity is logged to the console only — the worker does not currently call `logAudit()`.

> **Gap vs spec:** `risk_flags` are not currently purged. The spec calls for a 90-day purge after a lead is suppressed, but this is not yet implemented in the worker.

## Follow-up Processing Flow

The two-phase logic of `follow-up-sender` (initial send + lazy follow-up content generation, attempt-aware prompts, sequencing, the +3/+7/+14-day cadence, and reply short-circuiting) is documented in detail in `email-system.md` § Follow-up Behavior. This file owns only the schedule and operational notes.

## Mutation Runner

`mutation-runner` (Monday 06:00) auto-evolves the template pool. It only activates once **300+ total sends** have been recorded. For each of the 4 template types (`initial`, `followup_1`, `followup_2`, `breakup`), it:

1. Queries all active templates with `send_count ≥ 50` and `generation_depth < 5`.
2. Skips if fewer than 2 eligible templates exist for that type.
3. Generates two mutations via `generateMutation()` (Claude):
   - **Refine** — Thompson-sampled from top-25% by positive intent rate (improves what works).
   - **Replace** — the single worst bottom-25% performer (replaces what doesn't).
4. Inserts the new template as `active: true` with `generation_depth = parent + 1`.
5. Posts a JSON webhook to `MUTATION_NOTIFY_WEBHOOK_URL` if set (useful for Slack alerts).

Mutations include rich metadata: `mutation_mode`, persuasion strategy shift, `dimensions_changed`, `mutation_distance`, and `hypothesis_tested` — all stored on `prompt_templates` for auditability. See `email-system.md` § Template Mutation for the full description.

## Production Note: Process Separation

Workers are currently imported in-process (`import "./workers"` in `backend/src/index.ts`) for dev convenience. **Before deploying to production, remove that import** and manage two processes separately:

```bash
# Process 1 — HTTP API
bun run src/index.ts

# Process 2 — background workers
bun run workers
```

Running them separately means a cron crash doesn't take down the API, and their Postgres connection pools don't compete.
