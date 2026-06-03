# Email System

All outbound/inbound email behavior. Enforced in `services/sender` and `services/scoring`, with follow-ups driven by the `follow-up-sender` worker. See `workers.md` for cron timing and `database.md` for the tables referenced here.

## Draft Generation

Each lead is assigned to one or more campaigns by `services/campaign-assigner` (no cap on the number of campaigns). One draft is generated per campaign assignment — a lead in N campaigns gets N drafts, each tailored to that campaign's goal.

One draft per (lead, campaign) is enforced by the `UNIQUE (lead_id, campaign_id)` constraint on `email_drafts` (not an application-level constant).

Generation uses the Claude Haiku 4.5 Batch API. Each request selects a `prompt_templates` row by weighted-random and records `template_id` on the draft for engagement comparison. The confidence score is returned in the same call (no second request). Max length 125 words, enforced in-prompt and post-generation.

## Campaign Assignment Logic

`services/campaign-assigner` (Claude Haiku 4.5) assigns each enriched lead to one or more campaigns based on campaign goal + lead data (role, industry, intent, market). It writes one `campaign_assignments` row per assignment with an `assignment_reason`. There is no cap on the number of campaigns a lead can be assigned to.

> Status: not yet built — requires the `campaign_assignments` table. See `roadmap.md`.

## Confidence Scoring

Each draft is scored 0–100 across four equally weighted (25%) factors:

| Factor | Description |
|---|---|
| Lead data completeness | Role, company size, industry, market present |
| Campaign-goal alignment | Draft follows the assigned campaign's objective (re-engagement references prior relationship; certification upsell leads with ROI; event promo has a clear dated CTA). Generic language scores low. |
| Personalisation quality | Specificity and relevance to the lead's context |
| Length compliance | Under 125 words |

## Approval Workflow (send phases)

```
Phase 1 — total sent < 50:
  ALL drafts → rep approval queue (pending_review), regardless of confidence_score

Phase 2 — total sent ≥ 50:
  confidence_score ≥ 70 → auto-schedule (draft_status → scheduled)
  confidence_score < 70  → rep approval queue
```

Rep actions (target API): approve → `scheduled`; reject → `rejected` + reason; edit → re-score via `PATCH /drafts/:id/edit`.

The threshold is **50**, enforced by `shouldQueueForReview` in `backend/src/services/sender/index.ts`.

## Pre-send Checks (hard gates)

Every send must pass **before** SES is called (in `services/scoring` / `services/sender`):

1. Email not on `suppression_list`.
2. Lead not on `suppression_list` — re-checked at send time (enrichment also flags suppressed leads to `rep_review`).
3. Lead has no blocking `risk_flags` (e.g. `legal_keyword`, `hostile_interaction`).
4. `is_verified` is true (or policy allows the enrichment-worker retry path).
5. Body includes the **one-click unsubscribe** link (template requirement — never omit).
6. Market legal flags respected (SG PDPA / AU Privacy Act / US CAN-SPAM) via campaign + registry config.

## Send Cadence

**Max 2 emails per lead per week** across all active campaigns. Enforced in `services/sender` by counting `email_events.sent_at` per `lead_id` in a rolling 7-day window before scheduling. If the cap is reached, remaining drafts shift to the next available slot.

## Warm-up Ramp (daily send cap)

The ramp is **calendar-week based**, counting from the first successful send: week 1 = days 0–6, week 2 = days 7–13, etc. `getDailyCap()` in `backend/src/services/sender/index.ts` derives the week (via `getWarmupWeek()`) and returns the cap; the `warmup-tracker` worker (midnight) logs the current week/cap and `services/sender` enforces it. Count only successful SES sends. If the cap is hit, remaining `scheduled` drafts stay queued until the next day.

| Week | Max sends / day |
|---|---|
| 1 | 50 |
| 2 | 200 |
| 3 | 500 |
| 4+ | 1,000 |

## A/B Testing

At **schedule time** in `services/sender`:

- **80%** → control template variant
- **20%** → experimental variant

Outcomes are tracked by `template_id` via `GET /api/v1/analytics/templates`, which joins `email_drafts → email_events` live (open_rate / reply_rate per template). Rebalance by editing weights on the `/templates` admin page. A future cron may auto-rebalance (see `roadmap.md`).

## Follow-up Behavior (no reply)

The `follow-up-sender` worker runs daily at 9am in two phases:

**Phase A — initial send.** Finds `email_drafts` with `status = 'scheduled'` and no `email_events` row yet. Runs hard gates via `sendDraft()`. On success, inserts 3 `follow_ups` rows for that `(lead_id, campaign_id)` at **+3 / +7 / +14 days** with no content yet.

**Phase B — follow-up send.** Finds due `follow_ups` rows (`sent_at IS NULL`, `scheduled_at ≤ now`). If `subject`/`body` are null, generates content lazily via `generateFollowUpContent()` (Batch API, ~50% cheaper than sync) with attempt-aware prompts.

The exact prompt wording per attempt is **a work in progress** — the current direction is a light nudge early, additional value in the middle, and a break-up message last, but treat the specifics as not yet finalized. The structural rules below are settled.

Follow-up content does **not** include the previous email body — campaign context + attempt number are sufficient. Sends go through `sendFollowUpEmail()`, which enforces all gates (suppression, weekly cap, risk flags, verified, daily cap, campaign active).

Rules:

- Up to **3 attempts** per lead/campaign, enforced by only ever creating 3 `follow_ups` rows.
- Skip the lead entirely if `email_events.replied_at` is set.
- Sequential ordering: attempt N requires attempt N-1's `sent_at` to be set.

## Reply Handling (decision tree)

`POST /webhooks/ses/reply` → `services/reply-handler` (Haiku classification with prompt caching):

| Classification | Action |
|---|---|
| Positive | Create a `demos` row, assign a rep, notify the dashboard |
| Negative / unsubscribe | Add to `suppression_list`, stop follow-ups |
| Neutral / question | Route to the flagged queue for human review |
| Hostile / legal threat | Add `risk_flags` + suppress; **no auto-reply** |

Inbound matching: resolve the lead by `From` address; match the email event via `In-Reply-To` → `email_events.ses_message_id`; fall back to the most recent unread event if the header is absent.
