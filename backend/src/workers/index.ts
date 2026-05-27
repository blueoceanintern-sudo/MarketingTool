import cron from "node-cron";
import { db } from "../db";
import { followUps, leads, emailEvents, riskFlags, scrapeJobs, campaigns, templatePerformance, replies } from "../db/schema";
import { eq, and, isNull, lte, isNotNull, lt, desc, or, inArray } from "drizzle-orm";
import { sendDraft, getTotalSent } from "../services/sender";
import { runScrapeJob } from "../services/scraping/runScrapeJob";
import { enrichLead } from "../services/enrichment/orchestrator";

// ---------------------------------------------------------------------------
// warmup-tracker  — midnight daily
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * *", async () => {
  const totalSent = await getTotalSent();
  console.log(`[warmup-tracker] total sent all-time: ${totalSent}`);
});

// ---------------------------------------------------------------------------
// follow-up-sender  — 09:00 daily
// ---------------------------------------------------------------------------
cron.schedule("0 9 * * *", async () => {
  console.log("[follow-up-sender] running");

  const pending = await db
    .select({
      id: followUps.id,
      draftId: followUps.draftId,
      leadId: followUps.leadId,
      leadEmail: leads.email,
      isVerified: leads.isVerified,
    })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(isNull(followUps.sentAt), lte(followUps.scheduledAt, new Date())));

  let sent = 0;
  let blocked = 0;

  for (const fu of pending) {
    if (!fu.draftId) continue;

    // Skip if lead has already replied
    const [hasReply] = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(and(eq(emailEvents.leadId, fu.leadId), isNotNull(emailEvents.repliedAt)))
      .limit(1);
    if (hasReply) continue;

    // Check risk flags
    const [flag] = await db
      .select({ id: riskFlags.id })
      .from(riskFlags)
      .where(eq(riskFlags.leadId, fu.leadId))
      .limit(1);

    const result = await sendDraft({
      draftId: fu.draftId,
      toEmail: fu.leadEmail,
      leadId: fu.leadId,
      isVerified: fu.isVerified,
      hasRiskFlags: !!flag,
    });

    if (result.status === "sent") {
      await db.update(followUps).set({ sentAt: new Date() }).where(eq(followUps.id, fu.id));
      sent++;
    } else {
      blocked++;
    }

    // Stop if daily cap hit
    if (result.reason === "daily_cap_reached") break;
  }

  console.log(`[follow-up-sender] done: sent=${sent}, blocked=${blocked}`);
});

// ---------------------------------------------------------------------------
// scrape-retry  — 04:00 daily
// ---------------------------------------------------------------------------
cron.schedule("0 4 * * *", async () => {
  console.log("[scrape-retry] running");

  const failed = await db
    .select()
    .from(scrapeJobs)
    .where(and(eq(scrapeJobs.status, "failed"), lt(scrapeJobs.retryCount, scrapeJobs.maxRetries)));

  for (const job of failed) {
    await db
      .update(scrapeJobs)
      .set({ status: "running", retryCount: job.retryCount + 1, startedAt: new Date() })
      .where(eq(scrapeJobs.id, job.id));

    try {
      console.log(`[scrape-retry] retrying job ${job.id} for campaign ${job.campaignId}`);
      await runScrapeJob(job.id, job.campaignId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBlocked = msg.toLowerCase().includes("captcha");
      await db
        .update(scrapeJobs)
        .set({
          status: isBlocked ? "blocked" : "failed",
          errorMessage: msg,
          completedAt: new Date(),
        })
        .where(eq(scrapeJobs.id, job.id));
    }
  }

  console.log(`[scrape-retry] retried ${failed.length} jobs`);
});

// ---------------------------------------------------------------------------
// enrichment-retry  — 03:00 daily
// Picks leads that were never enriched, or whose last attempt returned
// not_found more than 7 days ago. Capped by ENRICHMENT_DAILY_RUN_CAP.
// ---------------------------------------------------------------------------
cron.schedule("0 3 * * *", async () => {
  console.log("[enrichment-retry] running");

  const cap = Number(process.env.ENRICHMENT_DAILY_RUN_CAP ?? 200);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      or(
        isNull(leads.enrichedAt),
        and(eq(leads.emailStatus, "not_found"), lt(leads.enrichedAt, sevenDaysAgo)),
      ),
    )
    .limit(cap);

  const counts = { attempted: 0, verified: 0, pattern_guessed: 0, not_found: 0, errors: 0 };

  for (const { id } of candidates) {
    counts.attempted++;
    try {
      const record = await enrichLead(id);
      counts[record.contact.email_status]++;
    } catch (err) {
      counts.errors++;
      console.error(`[enrichment-retry] lead ${id} failed:`, err);
    }
  }

  console.log(`[enrichment-retry] done: ${JSON.stringify(counts)}`);
});

// ---------------------------------------------------------------------------
// template-improver  — Sunday midnight
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * 0", async () => {
  console.log("[template-improver] running");

  const rows = await db
    .select()
    .from(templatePerformance)
    .orderBy(desc(templatePerformance.replyRate));

  for (const row of rows) {
    console.log(
      `[template-improver] campaign=${row.campaignId} persona=${row.persona} ` +
      `openRate=${row.openRate} replyRate=${row.replyRate}`
    );
  }

  console.log(`[template-improver] reviewed ${rows.length} template entries`);
});

// ---------------------------------------------------------------------------
// purge-old-records  — Sunday 02:00
// Retention: replies 180d, email_events 90d, scrape_jobs (failed/complete) 30d
// ---------------------------------------------------------------------------
cron.schedule("0 2 * * 0", async () => {
  console.log("[purge-old-records] running");

  const now = Date.now();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // Replies older than 180 days.
  const purgedReplies = await db
    .delete(replies)
    .where(lt(replies.receivedAt, oneEightyDaysAgo))
    .returning({ id: replies.id });

  // email_events older than 90 days — delete any linked replies first (FK constraint).
  const staleEvents = await db
    .select({ id: emailEvents.id })
    .from(emailEvents)
    .where(and(isNotNull(emailEvents.sentAt), lt(emailEvents.sentAt, ninetyDaysAgo)));

  let purgedEvents = 0;
  if (staleEvents.length > 0) {
    const ids = staleEvents.map((e) => e.id);
    await db.delete(replies).where(inArray(replies.emailEventId, ids));
    const deleted = await db
      .delete(emailEvents)
      .where(inArray(emailEvents.id, ids))
      .returning({ id: emailEvents.id });
    purgedEvents = deleted.length;
  }

  // scrape_jobs (failed or complete) older than 30 days.
  const purgedScrapeJobs = await db
    .delete(scrapeJobs)
    .where(
      and(
        or(eq(scrapeJobs.status, "failed"), eq(scrapeJobs.status, "complete")),
        lt(scrapeJobs.createdAt, thirtyDaysAgo),
      ),
    )
    .returning({ id: scrapeJobs.id });

  console.log(
    `[purge-old-records] done: replies=${purgedReplies.length}, ` +
    `emailEvents=${purgedEvents}, scrapeJobs=${purgedScrapeJobs.length}`,
  );
});

console.log("[workers] all cron jobs registered");
