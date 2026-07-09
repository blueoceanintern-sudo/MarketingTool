# Email System

All outbound/inbound email behavior. Enforced in `services/sender` and `services/scoring`, with follow-ups driven by the `follow-up-sender` worker. See `workers.md` for cron timing and `database.md` for the tables referenced here.

## Draft Generation

One draft is generated per (lead, campaign) pair. A lead in N campaigns gets N drafts, each tailored to that campaign's goal. This is enforced by the `UNIQUE (lead_id, campaign_id)` constraint on `email_drafts`.

Generation uses **parallel direct API calls** (`messages.create` via `Promise.allSettled`), not the Batch API — the function is named `generateDraftsBatch` but runs concurrent synchronous requests. Each request selects a `prompt_templates` row via Thompson Sampling and records `template_id` on the draft. Prompt caching (`cache_control: ephemeral`) is applied to the system prompt to reduce cost across the parallel calls.

Scoring is a **separate second set of API calls** (`scoreEmailsBatch`) — also parallel direct calls with prompt caching on the scoring system prompt. It is not part of the generation call.

The `drafting-runner` worker skips leads missing `name` or `role` — they are logged and excluded rather than drafted with blanks.

> **Follow-up content generation** (`generateFollowUpBatch`) does use the true Batch API (`messages.batches`) since follow-ups are generated lazily in bulk once per day rather than on demand.

## Campaign Assignment Logic

The goal is for `services/campaign-assigner` (Claude Haiku 4.5) to automatically assign each enriched lead to one or more campaigns based on campaign goal + lead data (role, industry, intent, market), writing one `campaign_assignments` row per assignment with an `assignment_reason`.

> **Status: not yet built.** No `campaign_assignments` table exists in the schema — leads are currently added to `campaign_leads` manually or via CSV import. The assigner service and its schema changes are both pending. See `roadmap.md` § Not-Yet-Built Components.

## Confidence Scoring

Each draft is scored 0–100 across four factors returned in `score_breakdown`:

| Factor | Max | How it's scored |
|---|---|---|
| `painPointFit` | 25 | Adversarial Claude call — is the pain point a realistic daily frustration for this specific role/industry? |
| `campaignAlignment` | 25 | Adversarial Claude call — does the email follow the campaign's specific objective without generic filler or unsupported claims? |
| `personalisationQuality` | 25 | Adversarial Claude call — is the email clearly written for this specific lead, or could it be sent to anyone? |
| `lengthCompliance` | 25 | Binary check — 25 if within the word limit for the template type, 0 if over |

`confidence_score = sum of all four`. The adversarial scoring uses a separate Claude call with prompt caching (not the same call that generates the draft).

Leads missing `name` or `role` are skipped before batch submission — incomplete leads are logged and excluded, not silently drafted with blanks.

## Approval Workflow

Drafts are created with `status = pending_review` by default, requiring a rep to act on them from the review queue. Once 50 total sends have been made, drafts with `confidence_score ≥ 70` are automatically created as `status = scheduled` — skipping the review queue.

The threshold is evaluated once per `generateDraftsForCampaign()` call (not per draft) using `getTotalSent()`, so the entire batch gets the same status. Before 50 sends, all drafts land in `pending_review` regardless of score.

Rep actions on `pending_review` drafts:
- **Approve** → `PATCH /drafts/:id/approve` → status becomes `scheduled`
- **Reject** → `PATCH /drafts/:id/reject` → status becomes `rejected` + reason stored
- **Edit** → `PATCH /drafts/:id/edit` → body re-scored, status reset to `pending_review`
- **Send now** → `POST /drafts/:id/send` → only valid on `scheduled` drafts; runs all hard gates

> **Implemented** — auto-schedule threshold wired in `backend/src/services/drafting/orchestrator.ts`.

## Email Transport & Deliverability

All outbound email goes through **AWS SES via `SendRawEmailCommand`** (not `SendEmailCommand`). Raw send is required because `SendEmailCommand` does not support custom headers — which are mandatory for deliverability.

**Why this matters (Gmail/Yahoo mandate, Feb 2024):** Bulk senders must include `List-Unsubscribe` and `List-Unsubscribe-Post` headers in every outbound email, or Gmail/Yahoo will reject or spam-folder the message.

Every outbound email (initial + follow-ups) includes these headers:

```
List-Unsubscribe: <{FRONTEND_URL}/api/unsubscribe?id={leadId}&campaign={campaignId}>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The `List-Unsubscribe` URL points to the **frontend proxy** (`/api/unsubscribe`), not the backend directly — port 3001 is firewalled externally. The frontend route proxies to the backend at `localhost:3001/unsubscribe` server-side, then redirects the browser to `/unsubscribe.html`.

**Gmail one-click (RFC 8058):** When a Gmail user clicks "Unsubscribe" in the Gmail UI, Gmail sends a silent POST to the `List-Unsubscribe` URL. The frontend route handles both GET (link click) and POST (Gmail one-click) — both trigger the same suppression logic.

The email body is constructed as a `multipart/alternative` MIME message with text/plain and text/html parts, both base64-encoded. This is built in `buildRawEmail()` in `backend/src/services/sender/index.ts`.

> **`FRONTEND_URL` must be set in the backend environment** (e.g. `https://yourdomain.com`). If unset, unsubscribe links will default to `localhost:3000` and break for recipients.

## Manual Send (per-draft)

Reps can manually trigger a send for any individual `scheduled` draft from the UI (Scheduled tab → Send button per row). This calls `POST /api/v1/drafts/:id/send`, which:

1. Verifies the draft status is `scheduled` (rejects with 409 otherwise).
2. Runs all pre-send hard gates via `sendDraft()`.
3. Returns `{ status: "sent" | "queued" | "blocked", messageId }`.
4. Logs the action to `audit_log` (`draft.send`).

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

## Template Selection (Thompson Sampling)

At **draft generation time**, the drafting service selects a `prompt_templates` row using **Thompson Sampling** — not a fixed 80/20 split. For each template, it draws a sample from a Beta distribution seeded by `(positive_intent_count + 1, send_count - positive_intent_count + 1)` and picks the highest draw. This naturally favours proven performers while still exploring under-tested variants.

Templates are soft-excluded if they have ≥ 30 sends AND:
- negative reply rate > 5%, or
- spam complaint rate > 1%

If all templates are excluded (unusual), the full pool is used as fallback.

Each template type has its own pool:

| Template type | Used for | Word limit |
|---|---|---|
| `initial` | First email to a lead | 125 words |
| `followup_1` | First follow-up (+3 days) | 90 words |
| `followup_2` | Second follow-up (+7 days) | 85 words |
| `breakup` | Third / final follow-up (+14 days) | 70 words |

Outcomes (sends, positive intent, negative replies, spam complaints) are tracked on `prompt_templates` counters and visible via `GET /api/v1/analytics/templates`. New variants are auto-generated by the `mutation-runner` worker (see `workers.md`).

## Template Mutation (mutation-runner)

The `mutation-runner` worker (Monday 06:00) automatically evolves the template pool once enough data exists. It activates only after **300+ total sends** and processes all 4 template types. For each type it generates two mutations:

- **Refine** — improves a top-25% performer (picked via Thompson Sampling among winners).
- **Replace** — overwrites the worst bottom-25% performer.

Eligibility: template must be `active`, have `send_count ≥ 50`, and `generation_depth < 5`. Mutations are inserted with `active: true` and a `generation_depth` one higher than their parent, so the sampling pool stays fresh automatically. A webhook notification is sent to `MUTATION_NOTIFY_WEBHOOK_URL` if set.

## Follow-up Behavior (no reply)

The `follow-up-sender` worker runs daily at 9am in two phases:

**Phase A — initial send.** Finds `email_drafts` with `status = 'scheduled'` and no `email_events` row yet. Runs hard gates via `sendDraft()`. On success, inserts 3 `follow_ups` rows for that `(lead_id, campaign_id)` at **+3 / +7 / +14 days** with no content yet.

**Phase B — follow-up send.** Finds due `follow_ups` rows (`sent_at IS NULL`, `scheduled_at ≤ now`). If `subject`/`body` are null, generates content lazily via `generateFollowUpBatch()` (true Batch API via `messages.batches`, ~50% cheaper than sync) with attempt-aware prompts.

`generateFollowUpContent()` passes: campaign context (description, pain points, CTA), lead context (name, role, company, industry, size, location), `original_subject` from the initial draft, `attempt_number`, and `previous_angle_tags` derived from prior `follow_ups.angle_tag` values for the same (lead, campaign). Follow-up content does **not** include the previous email body. Each follow-up returns an `angle_tag` that is persisted to `follow_ups.angle_tag` so subsequent attempts can exclude it.

Sends go through `sendFollowUpEmail()`, which enforces all gates (suppression, weekly cap, risk flags, verified, daily cap, campaign active).

Rules:

- Up to **3 attempts** per lead/campaign, enforced by only ever creating 3 `follow_ups` rows.
- Skip the lead entirely if `email_events.replied_at` is set.
- Sequential ordering: attempt N requires attempt N-1's `sent_at` to be set.

## Reply Handling (decision tree)

`POST /webhooks/ses/reply` → `services/reply-classifier` (Haiku classification, plain `messages.create`, no prompt caching):

| Classification | Action |
|---|---|
| Positive | Create a `demos` row (`assigned_to = null`) and notify the dashboard. Rep assigns themselves via `PATCH /demos/:id/assign`. |
| Negative / unsubscribe | Add to `suppression_list` (`reason: manual`), stop follow-ups, cancel pending drafts. If reply contains legal threats or hostile language (`risk_flag: true`), also insert `risk_flags` (`hostile_interaction`). |
| Out of office | Reschedule the next follow-up to the stated return date (default +7 days if none given) |
| Neutral / question | Route to the flagged queue for human review; follow-up sequence continues |

Inbound matching: resolve the lead by `From` address; match the email event via `In-Reply-To` → `email_events.ses_message_id`; fall back to the oldest unreplied event for that lead if the header is absent.
