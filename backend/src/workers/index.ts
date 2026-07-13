import cron from "node-cron";
import { db } from "../db";
import { followUps, leads, emailEvents, emailDrafts, riskFlags, scrapeJobs, campaigns, replies, companies, geoPlaces, promptTemplates, suppressionList } from "../db/schema";
import { logAudit } from "../services/audit/log";
import { eq, and, isNull, lte, isNotNull, lt, or, inArray, notInArray, asc, gte, sql } from "drizzle-orm";
import { sendDraft, sendFollowUpEmail, getTotalSent, getWarmupWeek, getDailyCap } from "../services/sender";
import { runScrapeJob } from "../services/scraping/runScrapeJob";
import { enrichLead } from "../services/enrichment/orchestrator";
import { generateDraftsForCampaign } from "../services/drafting/orchestrator";
import { generateFollowUpBatch, thompsonSample, type FollowUpRequest } from "../services/drafting";
import { generateMutation } from "../services/mutator";

const MAX_FOLLOW_UP_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// warmup-tracker  — midnight daily
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * *", async () => {
  const [totalSent, week, dailyCap] = await Promise.all([getTotalSent(), getWarmupWeek(), getDailyCap()]);
  console.log(`[warmup-tracker] total sent all-time: ${totalSent} | warm-up week ${week} → daily cap ${dailyCap}`);
});

// ---------------------------------------------------------------------------
// follow-up-sender  — 09:00 daily
//
// Phase A: Send approved (scheduled) drafts that haven't been sent yet.
//   On success, create follow_ups rows for attempts 1–3 (+3/+7/+14 days).
//
// Phase B: Process pending follow_ups rows lazily.
//   If subject/body are null, generate them via the Batch API first.
//   Skip if lead has already replied; enforce sequential attempt ordering.
//
// Exported so it can be called directly in tests/scripts without waiting
// for the 9am schedule.
// ---------------------------------------------------------------------------
export async function runFollowUpSender() {
  console.log("[follow-up-sender] running");

  let sent = 0;
  let blocked = 0;
  let capHit = false;

  // ── Phase A: send scheduled drafts ────────────────────────────────────────
  // Find drafts with status=scheduled that have no email_events row yet (i.e.
  // never sent — not a re-send of an existing sent draft).
  const alreadySentDraftIds = (
    await db.select({ draftId: emailEvents.draftId }).from(emailEvents).where(isNotNull(emailEvents.sentAt))
  ).map((r) => r.draftId);

  const scheduledDrafts = await db
    .select({
      id: emailDrafts.id,
      leadId: emailDrafts.leadId,
      campaignId: emailDrafts.campaignId,
      leadEmail: leads.email,
      isVerified: leads.isVerified,
    })
    .from(emailDrafts)
    .innerJoin(leads, eq(emailDrafts.leadId, leads.id))
    .where(
      and(
        eq(emailDrafts.status, "scheduled"),
        alreadySentDraftIds.length > 0 ? notInArray(emailDrafts.id, alreadySentDraftIds) : undefined,
      ),
    );

  console.log(`[follow-up-sender] Phase A: found ${scheduledDrafts.length} scheduled draft(s)`);

  for (const draft of scheduledDrafts) {
    if (capHit) break;

    const [flag] = await db.select({ id: riskFlags.id }).from(riskFlags).where(eq(riskFlags.leadId, draft.leadId)).limit(1);

    let result: Awaited<ReturnType<typeof sendDraft>>;
    try {
      result = await sendDraft({
        draftId: draft.id,
        toEmail: draft.leadEmail,
        leadId: draft.leadId,
        campaignId: draft.campaignId,
        isVerified: draft.isVerified,
        hasRiskFlags: !!flag,
      });
    } catch (err) {
      console.error(`[follow-up-sender] Phase A: draft ${draft.id} threw:`, err);
      blocked++;
      continue;
    }

    console.log(`[follow-up-sender] Phase A: draft ${draft.id} → ${draft.leadEmail} → ${result.status}${result.reason ? `:${result.reason}` : ""}`);

    if (result.status === "sent") {
      sent++;
      const now = Date.now();
      const offsets = [3, 7, 14];
      await db.insert(followUps).values(
        offsets.map((days, i) => ({
          leadId: draft.leadId,
          campaignId: draft.campaignId,
          attemptNumber: i + 1,
          scheduledAt: new Date(now + days * 24 * 60 * 60 * 1000),
          draftId: draft.id,
        })),
      );
      console.log(`[follow-up-sender] Phase A: follow_ups created for lead ${draft.leadId} (+3/+7/+14 days)`);
    } else {
      blocked++;
    }

    if (result.reason === "daily_cap_reached") capHit = true;
  }

  // ── Phase B: send pending follow-ups (lazy content generation) ────────────
  if (!capHit) {
    const pending = await db
      .select({
        id: followUps.id,
        draftId: followUps.draftId,
        templateId: followUps.templateId,
        subject: followUps.subject,
        body: followUps.body,
        leadId: followUps.leadId,
        campaignId: followUps.campaignId,
        attemptNumber: followUps.attemptNumber,
        leadEmail: leads.email,
        isVerified: leads.isVerified,
        leadName: leads.name,
        leadRole: leads.role,
        companyName: companies.name,
        companyIndustry: companies.industry,
        companySize: companies.companySize,
        companyLocation: geoPlaces.name,
        originalSubject: emailDrafts.subject,
      })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
      .innerJoin(companies, eq(leads.companyId, companies.id))
      .leftJoin(geoPlaces, eq(companies.geonameId, geoPlaces.geonameId))
      .leftJoin(emailDrafts, eq(followUps.draftId, emailDrafts.id))
      .where(and(isNull(followUps.sentAt), lte(followUps.scheduledAt, new Date())));

    console.log(`[follow-up-sender] Phase B: found ${pending.length} pending follow-up(s)`);

    // Pass 1: qualify (sequential ordering + no reply + has draftId)
    const qualified = [] as typeof pending;

    for (const fu of pending) {
      if (capHit) break;
      if (fu.attemptNumber > MAX_FOLLOW_UP_ATTEMPTS) continue;
      if (!fu.draftId) {
        console.warn(`[follow-up-sender] follow_up ${fu.id} has no draftId — skipping`);
        continue;
      }

      if (fu.attemptNumber > 1) {
        const [prev] = await db
          .select({ sentAt: followUps.sentAt })
          .from(followUps)
          .where(
            and(
              eq(followUps.leadId, fu.leadId),
              eq(followUps.campaignId, fu.campaignId),
              eq(followUps.attemptNumber, fu.attemptNumber - 1),
            ),
          )
          .limit(1);
        if (!prev?.sentAt) continue;
      }

      const [hasReply] = await db
        .select({ id: emailEvents.id })
        .from(emailEvents)
        .where(and(eq(emailEvents.leadId, fu.leadId), isNotNull(emailEvents.repliedAt)))
        .limit(1);
      if (hasReply) {
        console.log(`[follow-up-sender] Phase B: follow_up ${fu.id} attempt ${fu.attemptNumber} → skipped (lead replied)`);
        continue;
      }

      qualified.push(fu);
    }

    // Pass 2: batch-generate missing content in a single Batch API call
    const needsContent = qualified.filter((fu) => !fu.subject || !fu.body);
    const contentMap = new Map<string, { subject: string; body: string; templateId?: string }>();

    if (needsContent.length > 0) {
      const batchRequests: FollowUpRequest[] = [];

      for (const fu of needsContent) {
        const [campaignRow] = await db
          .select({ name: campaigns.name, description: campaigns.description, painPoints: campaigns.painPoints, callToAction: campaigns.callToAction })
          .from(campaigns)
          .where(eq(campaigns.id, fu.campaignId))
          .limit(1);
        if (!campaignRow) continue;

        // Angle tags from already-sent follow-ups for this lead+campaign (attempts < current).
        // These tell the next email which operational angles have already been used.
        const prevFollowUps =
          fu.attemptNumber > 1
            ? await db
                .select({ angleTag: followUps.angleTag, attemptNumber: followUps.attemptNumber })
                .from(followUps)
                .where(
                  and(
                    eq(followUps.leadId, fu.leadId),
                    eq(followUps.campaignId, fu.campaignId),
                    isNotNull(followUps.sentAt),
                    lt(followUps.attemptNumber, fu.attemptNumber),
                  ),
                )
                .orderBy(asc(followUps.attemptNumber))
            : [];

        const previousAngleTags = prevFollowUps
          .filter((p) => p.angleTag !== null)
          .map((p) => p.angleTag as string);

        batchRequests.push({
          followUpId: fu.id,
          leadId: fu.leadId,
          campaignId: fu.campaignId,
          lead: {
            name: fu.leadName ?? undefined,
            role: fu.leadRole ?? undefined,
            companyName: fu.companyName,
            industry: fu.companyIndustry ?? undefined,
            companySize: fu.companySize ?? undefined,
            location: fu.companyLocation ?? undefined,
          },
          campaign: campaignRow,
          attemptNumber: fu.attemptNumber,
          originalSubject: fu.originalSubject ?? "",
          previousAngleTags,
        });
      }

      if (batchRequests.length > 0) {
        try {
          const generated = await generateFollowUpBatch(batchRequests);
          for (const gen of generated) {
            await db
              .update(followUps)
              .set({ subject: gen.subject, body: gen.body, angleTag: gen.angleTag, templateId: gen.templateId || null })
              .where(eq(followUps.id, gen.followUpId));
            contentMap.set(gen.followUpId, { subject: gen.subject, body: gen.body, templateId: gen.templateId || undefined });
          }
        } catch (err) {
          console.error("[follow-up-sender] batch content generation failed:", err);
        }
      }
    }

    // Pass 3: send all qualified follow-ups
    for (const fu of qualified) {
      if (capHit) break;

      const subject = fu.subject ?? contentMap.get(fu.id)?.subject;
      const body = fu.body ?? contentMap.get(fu.id)?.body;
      if (!subject || !body) continue;

      const [flag] = await db.select({ id: riskFlags.id }).from(riskFlags).where(eq(riskFlags.leadId, fu.leadId)).limit(1);

      let result: Awaited<ReturnType<typeof sendFollowUpEmail>>;
      try {
        result = await sendFollowUpEmail({
          followUpId: fu.id,
          originalDraftId: fu.draftId!,
          subject,
          body,
          toEmail: fu.leadEmail,
          leadId: fu.leadId,
          campaignId: fu.campaignId,
          isVerified: fu.isVerified,
          hasRiskFlags: !!flag,
          templateId: fu.templateId ?? contentMap.get(fu.id)?.templateId,
        });
      } catch (err) {
        console.error(`[follow-up-sender] Phase B: follow_up ${fu.id} threw:`, err);
        blocked++;
        continue;
      }

      console.log(`[follow-up-sender] Phase B: follow_up ${fu.id} attempt ${fu.attemptNumber} → ${fu.leadEmail} → ${result.status}${result.reason ? `:${result.reason}` : ""}`);

      if (result.status === "sent") {
        await db.update(followUps).set({ sentAt: new Date() }).where(eq(followUps.id, fu.id));
        sent++;
      } else {
        blocked++;
      }

      if (result.reason === "daily_cap_reached") capHit = true;
    }
  }

  console.log(`[follow-up-sender] done: sent=${sent}, blocked=${blocked}`);
  return { sent, blocked };
}

cron.schedule("0 9 * * *", runFollowUpSender);

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

  // Only retry scraped leads — CSV-imported leads (scraperUsed = null) are never enriched.
  const candidates = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        isNotNull(leads.scraperUsed),
        or(
          isNull(leads.enrichedAt),
          and(eq(leads.emailStatus, "not_found"), lt(leads.enrichedAt, sevenDaysAgo)),
        ),
      ),
    )
    .limit(cap);

  const counts = { attempted: 0, verified: 0, pattern_guessed: 0, not_found: 0, errors: 0 };

  for (const { id } of candidates) {
    counts.attempted++;
    try {
      const { record } = await enrichLead(id);
      counts[record.contact.email_status]++;
    } catch (err) {
      counts.errors++;
      console.error(`[enrichment-retry] lead ${id} failed:`, err);
    }
  }

  console.log(`[enrichment-retry] done: ${JSON.stringify(counts)}`);
  console.log("[task:5] ✓ enrichment-retry ran — scraped leads only filter applied");
});

// ---------------------------------------------------------------------------
// purge-old-records  — Sunday 02:00
// Retention: replies 180d, email_events 365d, scrape_jobs (failed/complete) 30d
// email_events kept 365d so the weekly send-cap check (7d window) and
// historical analytics always have data; replies kept 180d for engagement insights.
// ---------------------------------------------------------------------------
cron.schedule("0 2 * * 0", async () => {
  console.log("[purge-old-records] running");

  const now = Date.now();
  const oneEightyDaysAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);
  const threeSixtyFiveDaysAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  // Replies older than 180 days.
  const purgedReplies = await db
    .delete(replies)
    .where(lt(replies.receivedAt, oneEightyDaysAgo))
    .returning({ id: replies.id });

  // email_events older than 365 days — delete any linked replies first (FK constraint).
  const staleEvents = await db
    .select({ id: emailEvents.id })
    .from(emailEvents)
    .where(and(isNotNull(emailEvents.sentAt), lt(emailEvents.sentAt, threeSixtyFiveDaysAgo)));

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

  // risk_flags: delete flags for leads that have been suppressed for 90+ days.
  const suppressedLeadIds = (
    await db
      .select({ id: leads.id })
      .from(leads)
      .innerJoin(suppressionList, eq(suppressionList.email, leads.email))
      .where(lt(suppressionList.addedAt, ninetyDaysAgo))
  ).map((r) => r.id);

  let purgedRiskFlags = 0;
  if (suppressedLeadIds.length > 0) {
    const deleted = await db
      .delete(riskFlags)
      .where(inArray(riskFlags.leadId, suppressedLeadIds))
      .returning({ id: riskFlags.id });
    purgedRiskFlags = deleted.length;
  }

  console.log(
    `[purge-old-records] done: replies=${purgedReplies.length}, ` +
    `emailEvents=${purgedEvents}, scrapeJobs=${purgedScrapeJobs.length}, ` +
    `riskFlags=${purgedRiskFlags}`,
  );

  await logAudit({
    actor: "system",
    action: "purge.records",
    targetType: "purge",
    metadata: {
      replies: purgedReplies.length,
      email_events: purgedEvents,
      scrape_jobs: purgedScrapeJobs.length,
      risk_flags: purgedRiskFlags,
    },
  });
});

// ---------------------------------------------------------------------------
// drafting-runner  — every 30 min
// Generates email drafts for every active campaign with eligible leads
// (routing=auto_queue, no existing draft). Manual "Generate Drafts Now"
// on the campaign page hits the same orchestrator; this is the unattended
// path that runs on its own.
// ---------------------------------------------------------------------------
cron.schedule("*/30 * * * *", async () => {
  console.log("[drafting-runner] running");

  const activeCampaigns = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.status, "active"));

  let totalGenerated = 0;
  let campaignsWithWork = 0;

  for (const c of activeCampaigns) {
    try {
      const result = await generateDraftsForCampaign(c.id);
      if (result.generated > 0) {
        campaignsWithWork++;
        totalGenerated += result.generated;
        console.log(`[drafting-runner] ${c.name}: generated=${result.generated}`);
      }
      if (result.errors.length > 0) {
        console.warn(`[drafting-runner] ${c.name} errors: ${result.errors.join("; ")}`);
      }
    } catch (err) {
      console.error(`[drafting-runner] campaign ${c.id} failed:`, err);
    }
  }

  console.log(
    `[drafting-runner] done: campaigns=${activeCampaigns.length}, with_work=${campaignsWithWork}, drafts=${totalGenerated}`,
  );
});

// ---------------------------------------------------------------------------
// mutation-runner  — Monday 06:00
//
// Fires only after 300+ total sends across the pool. Picks the top-performing
// eligible template (active, generation_depth < 2, send_count >= 50) by
// positive intent rate, generates one mutation via Claude, inserts it as
// inactive (requires manual activation), and notifies via webhook if configured.
// ---------------------------------------------------------------------------
export async function runMutationRunner() {
  console.log("[mutation-runner] running");

  const totalSent = await getTotalSent();
  if (totalSent < 300) {
    console.log(`[mutation-runner] skipped — ${totalSent} total sends so far (need 300+)`);
    return;
  }

  const TEMPLATE_TYPES = ["initial", "followup_1", "followup_2", "breakup"] as const;
  const notifyUrl = process.env.MUTATION_NOTIFY_WEBHOOK_URL;

  for (const templateType of TEMPLATE_TYPES) {
    // Only mutate human-authored templates to prevent constraint drift across lineages
    const eligible = await db
      .select()
      .from(promptTemplates)
      .where(
        and(
          eq(promptTemplates.active, true),
          eq(promptTemplates.templateType, templateType),
          lt(promptTemplates.generationDepth, 5),
          gte(promptTemplates.sendCount, 50),
        ),
      );

    if (eligible.length < 2) {
      console.log(`[mutation-runner] ${templateType}: fewer than 2 eligible templates — skipping`);
      continue;
    }

    // Rank by positive rate descending — used for percentile calculation and loser selection
    const rankedTemplates = [...eligible].sort((a, b) => {
      const rateA = a.sendCount > 0 ? a.positiveIntentCount / a.sendCount : 0;
      const rateB = b.sendCount > 0 ? b.positiveIntentCount / b.sendCount : 0;
      return rateB - rateA;
    });

    const total = rankedTemplates.length;

    // Split by the same percentile thresholds used inside getMutationPrompt
    const winners = rankedTemplates.filter((_, i) => i / (total - 1) <= 0.25);
    const losers = rankedTemplates.filter((_, i) => i / (total - 1) >= 0.75);

    // Refine: Thompson explores among top performers so #1 doesn't monopolise the lineage
    const refineCandidate = thompsonSample(winners);
    // Replace: always target the single worst performer
    const replaceCandidate = losers[losers.length - 1];

    const candidates = [
      { candidate: refineCandidate, label: "refine" },
      { candidate: replaceCandidate, label: "replace" },
    ] as const;

    for (const { candidate, label } of candidates) {
      if (!candidate) {
        console.log(`[mutation-runner] ${templateType}: no ${label} candidate — skipping`);
        continue;
      }

      const candidateRate = candidate.sendCount > 0
        ? `${(candidate.positiveIntentCount / candidate.sendCount * 100).toFixed(1)}%`
        : "0.0%";
      console.log(`[mutation-runner] ${templateType} [${label}]: candidate "${candidate.name}" (${candidateRate} positive rate, ${candidate.sendCount} sends)`);

      const result = await generateMutation(candidate.id, rankedTemplates);
      if (!result) {
        console.log(`[mutation-runner] ${templateType} [${label}]: generation failed — skipping`);
        continue;
      }

      const [inserted] = await db
        .insert(promptTemplates)
        .values({
          name: result.name,
          description: result.description,
          systemPrompt: result.systemPrompt,
          templateType: candidate.templateType,
          active: true,
          parentTemplateId: candidate.id,
          generationDepth: candidate.generationDepth + 1,
          createdBy: "ai",
          mutationMode: result.mutationMode,
          parentPersuasionStrategy: result.parentPersuasionStrategy,
          childPersuasionStrategy: result.childPersuasionStrategy,
          dimensionsChanged: result.dimensionsChanged,
          mutationDistance: result.mutationDistance,
          mutationReason: result.mutationReason,
          hypothesisTested: result.hypothesisTested,
        })
        .returning({ id: promptTemplates.id });

      console.log(`[mutation-runner] ${templateType} [${label}]: created "${result.name}" (id: ${inserted?.id}, mode: ${result.mutationMode}, depth: ${candidate.generationDepth + 1})`);

      if (notifyUrl && inserted) {
        await fetch(notifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "mutation_created",
            template_type: templateType,
            template_id: inserted.id,
            template_name: result.name,
            template_description: result.description,
            mutation_mode: result.mutationMode,
            parent_persuasion_strategy: result.parentPersuasionStrategy,
            child_persuasion_strategy: result.childPersuasionStrategy,
            dimensions_changed: result.dimensionsChanged,
            mutation_distance: result.mutationDistance,
            hypothesis_tested: result.hypothesisTested,
            parent_id: candidate.id,
            parent_name: candidate.name,
            parent_positive_rate: candidateRate,
            parent_send_count: candidate.sendCount,
            generation_depth: candidate.generationDepth + 1,
          }),
        }).catch((err) => console.error(`[mutation-runner] ${templateType} [${label}]: webhook notify failed:`, err));
      }
    }
  }
}

cron.schedule("0 6 * * 1", runMutationRunner);

console.log("[workers] all cron jobs registered");
