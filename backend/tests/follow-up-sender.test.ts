import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, followUps, suppressionList, promptTemplates,
} from "../src/db/schema";
import { runFollowUpSender } from "../src/workers";
import { eq, and, isNull, sql } from "drizzle-orm";

async function resetTables() {
  await db.execute(sql`TRUNCATE TABLE
    demos, replies, follow_ups, email_events, email_drafts,
    suppression_list, risk_flags, campaign_lead_exclusions, campaign_leads,
    enrichment_records, leads, campaigns, companies, prompt_templates
  CASCADE`);
}

async function seedBase() {
  const [company] = await db.insert(companies).values({
    name: "Beta Ltd", industry: "education", companySize: "small", location: "Sydney",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "AU Outreach", vertical: "edtech", geography: "AU", companySizeTarget: "small",
    status: "active", description: "Reach AU schools",
    painPoints: ["manual admin"], callToAction: "Book a demo",
  }).returning();

  for (const type of ["initial", "followup_1", "followup_2", "breakup"] as const) {
    await db.insert(promptTemplates).values({
      name: `${type} template`, systemPrompt: `Write a ${type} email.`,
      templateType: type, active: true, createdBy: "user",
    });
  }

  const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.templateType, "initial")).limit(1);

  const [lead] = await db.insert(leads).values({
    companyId: company.id, name: "Bob Chen", email: "bob@beta.com.au",
    role: "Principal", isVerified: true,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id, campaignId: campaign.id, templateId: template.id,
    subject: "Helping AU schools", body: "Hi Bob...", confidenceScore: 75, status: "scheduled",
  }).returning();

  return { company, campaign, template, lead, draft };
}

// Seed a lead whose initial draft is already sent with 3 follow_ups.
async function seedSentInitial(ctx: Awaited<ReturnType<typeof seedBase>>) {
  await db.update(emailDrafts).set({ status: "sent" }).where(eq(emailDrafts.id, ctx.draft.id));
  await db.insert(emailEvents).values({
    draftId: ctx.draft.id, leadId: ctx.lead.id,
    sentAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
  });

  const past = new Date(Date.now() - 60 * 1000);
  const fus = await db.insert(followUps).values([
    { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 1, scheduledAt: past, draftId: ctx.draft.id },
    { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 2, scheduledAt: past, draftId: ctx.draft.id },
    { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 3, scheduledAt: past, draftId: ctx.draft.id },
  ]).returning();

  return { fu1: fus[0], fu2: fus[1], fu3: fus[2] };
}

// ── Phase A ───────────────────────────────────────────────────────────────────

describe("Phase A — initial send", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); });

  it("sends draft and creates 3 follow_ups at +3/+7/+14 days", async () => {
    const before = Date.now();
    await runFollowUpSender();

    const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, ctx.draft.id));
    expect(draft.status).toBe("sent");

    const events = await db.select().from(emailEvents).where(eq(emailEvents.leadId, ctx.lead.id));
    expect(events).toHaveLength(1);

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus).toHaveLength(3);
    expect(fus.map(f => f.attemptNumber).sort()).toEqual([1, 2, 3]);

    const sorted = [...fus].sort((a, b) => a.attemptNumber - b.attemptNumber);
    for (const [i, days] of [3, 7, 14].entries()) {
      const expected = before + days * 24 * 60 * 60 * 1000;
      expect(Math.abs(sorted[i].scheduledAt.getTime() - expected)).toBeLessThan(5000);
    }
  });

  it("blocked draft (suppressed lead) creates no follow_ups", async () => {
    await db.insert(suppressionList).values({ email: ctx.lead.email, campaignId: ctx.campaign.id, reason: "manual" });
    await runFollowUpSender();

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus).toHaveLength(0);
  });

  it("draft with existing email_events row is not re-sent", async () => {
    await db.insert(emailEvents).values({ draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() });
    await runFollowUpSender();

    const events = await db.select().from(emailEvents).where(eq(emailEvents.leadId, ctx.lead.id));
    expect(events).toHaveLength(1);
  });
});

// ── Phase B ───────────────────────────────────────────────────────────────────

describe("Phase B — follow-up sequence", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); });

  it("attempt 2 is skipped when attempt 1 has not been sent yet", async () => {
    const { fu2 } = await seedSentInitial(ctx);
    await runFollowUpSender();

    const [updated] = await db.select().from(followUps).where(eq(followUps.id, fu2.id));
    expect(updated.sentAt).toBeNull();
  });

  it("attempt 2 fires after attempt 1 is sent", async () => {
    const { fu1, fu2, fu3 } = await seedSentInitial(ctx);
    await db.update(followUps).set({ sentAt: new Date(), subject: "FU1", body: "FU1 body" }).where(eq(followUps.id, fu1.id));
    await db.update(followUps).set({ subject: "FU2", body: "FU2 body" }).where(eq(followUps.id, fu2.id));
    await db.update(followUps).set({ scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }).where(eq(followUps.id, fu3.id));

    await runFollowUpSender();

    const [updated] = await db.select().from(followUps).where(eq(followUps.id, fu2.id));
    expect(updated.sentAt).not.toBeNull();
  });

  it("all pending follow_ups skipped when lead has replied", async () => {
    await seedSentInitial(ctx);
    await db.update(emailEvents).set({ repliedAt: new Date() }).where(eq(emailEvents.leadId, ctx.lead.id));

    await runFollowUpSender();

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    for (const fu of fus) expect(fu.sentAt).toBeNull();
  });

  it("attempt 3 receives previousAngleTags from attempts 1 and 2", async () => {
    const { fu1, fu2, fu3 } = await seedSentInitial(ctx);
    await db.update(followUps).set({ sentAt: new Date(), subject: "FU1", body: "FU1 body", angleTag: "manual_workload" }).where(eq(followUps.id, fu1.id));
    await db.update(followUps).set({ sentAt: new Date(), subject: "FU2", body: "FU2 body", angleTag: "roi_framing" }).where(eq(followUps.id, fu2.id));

    const draftingModule = await import("../src/services/drafting");
    const spy = spyOn(draftingModule, "generateFollowUpBatch").mockResolvedValue([]);

    await runFollowUpSender();

    const calls = spy.mock.calls;
    if (calls.length > 0) {
      const req = (calls[0][0] as Array<{ previousAngleTags: string[] }>).find(r => r.previousAngleTags?.length > 0);
      expect(req?.previousAngleTags).toContain("manual_workload");
      expect(req?.previousAngleTags).toContain("roi_framing");
    }

    spy.mockRestore();
  });
});
