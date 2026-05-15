import cron from "node-cron";
import { drafts } from "../routes/drafts";
import { suppressionList } from "../routes/replies";
import { shouldQueueForReview, setTotalSent, getTotalSent } from "../services/sender";
import { scrapeWithFallback } from "../services/scrapers/crawl4aiScraper";

// ---------------------------------------------------------------------------
// warmup-tracker  — midnight daily
// Resets daily send cap reference point; in-memory only until DB is wired.
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * *", () => {
  console.log(`[warmup-tracker] total sent: ${getTotalSent()}`);
  // When Drizzle is wired: query COUNT(*) from email_events where sent_at IS NOT NULL
  // and call setTotalSent(count) to keep the sender service in sync.
});

// ---------------------------------------------------------------------------
// follow-up-sender  — 09:00 daily
// Sends follow-up drafts (attempt 1→3) for leads with no reply.
// ---------------------------------------------------------------------------
cron.schedule("0 9 * * *", async () => {
  console.log("[follow-up-sender] running");

  // TODO (DB): query follow_ups WHERE sent_at IS NULL AND scheduled_at <= NOW()
  //            joined with email_events WHERE replied_at IS NULL
  //            and leads NOT in suppression_list
  //            then call sendDraft() per row, respecting warm-up cap.
  // Stub: no-op until Drizzle tables are wired.
  console.log("[follow-up-sender] stub — wire to DB follow_ups table");
});

// ---------------------------------------------------------------------------
// scrape-retry  — 04:00 daily
// Retries scrape_jobs that failed and are under max_retries.
// ---------------------------------------------------------------------------
cron.schedule("0 4 * * *", async () => {
  console.log("[scrape-retry] running");

  // TODO (DB): query scrape_jobs WHERE status = 'failed' AND retry_count < max_retries
  //            update status = 'running', increment retry_count, call scrapeWithFallback(url)
  //            on success: status = 'complete'; on error: status = 'failed' (or 'blocked' on CAPTCHA)
  // Stub: no-op until Drizzle scrape_jobs table is wired.
  console.log("[scrape-retry] stub — wire to DB scrape_jobs table");
});

// ---------------------------------------------------------------------------
// enrichment-retry  — 03:00 daily
// Retries Snov.io enrichment for leads where is_verified = false.
// Deferred: enrichment service not yet connected.
// ---------------------------------------------------------------------------
cron.schedule("0 3 * * *", async () => {
  console.log("[enrichment-retry] stub — enrichment service not yet connected");
  // TODO: query leads WHERE is_verified = false AND email IS NOT NULL
  //       call enrichLead() per row, update lead record on success
});

// ---------------------------------------------------------------------------
// template-improver  — Sunday midnight
// Promotes best-performing persona variants based on open_rate / reply_rate.
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * 0", async () => {
  console.log("[template-improver] running");

  // TODO (DB): query template_performance WHERE open_rate or reply_rate data covers 50+ sends
  //            per campaign_id + persona combination
  //            identify top variant, write result to skill.md or update control template
  // Stub: no-op until template_performance table has data.
  console.log("[template-improver] stub — wire to DB template_performance table");
});

console.log("[workers] all cron jobs registered");
