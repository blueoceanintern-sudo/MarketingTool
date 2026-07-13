import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, suppressionList, promptTemplates,
} from "../src/db/schema";
import { sendDraft, shouldQueueForReview } from "../src/services/sender";
import { eq, and, sql } from "drizzle-orm";

async function resetTables() {
  await db.execute(sql`TRUNCATE TABLE
    demos, replies, follow_ups, email_events, email_drafts,
    suppression_list, risk_flags, campaign_lead_exclusions, campaign_leads,
    enrichment_records, leads, campaigns, companies, prompt_templates
  CASCADE`);
}

async function seedBase() {
  const [company] = await db.insert(companies).values({
    name: "Acme Corp", industry: "technology", companySize: "medium", location: "Singapore",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "Cold Outreach SG", vertical: "saas",
    companySizeTarget: "medium", status: "active",
  }).returning();

  const [template] = await db.insert(promptTemplates).values({
    name: "Base Template", systemPrompt: "You are helpful.", templateType: "initial",
    active: true, createdBy: "user",
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id, name: "Alice Tan", email: "alice@acme.com",
    role: "Director", isVerified: true,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id, campaignId: campaign.id, templateId: template.id,
    subject: "Quick question", body: "Hi Alice...", confidenceScore: 80, status: "scheduled",
  }).returning();

  return { company, campaign, template, lead, draft };
}

// ── Pre-Send Gate Tests ───────────────────────────────────────────────────────

describe("Pre-send gates", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => { await resetTables(); ctx = await seedBase(); });

  it("suppression list blocks send for this campaign", async () => {
    await db.insert(suppressionList).values({ email: ctx.lead.email, campaignId: ctx.campaign.id, reason: "manual" });
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("suppression_list");
  });

  it("suppression for a different campaign does NOT block send", async () => {
    const [other] = await db.insert(campaigns).values({ name: "Other", vertical: "saas", companySizeTarget: "medium", status: "active" }).returning();
    await db.insert(suppressionList).values({ email: ctx.lead.email, campaignId: other.id, reason: "manual" });
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("sent");
  });

  it("weekly cap blocks send after 2 emails in 7 days", async () => {
    await db.insert(emailEvents).values([
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() },
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() },
    ]);
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("weekly_cap_reached");
  });

  it("2 emails older than 7 days do NOT trigger the weekly cap", async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.insert(emailEvents).values([
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: old },
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: old },
    ]);
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("sent");
  });

  it("risk flag blocks send", async () => {
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: true });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("risk_flags");
  });

  it("unverified email blocks send", async () => {
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: false, hasRiskFlags: false });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("unverified_email");
  });

  it("daily warmup cap queues (not blocks) the send", async () => {
    // Yesterday sets firstSentAt → week 1 → dailyCap = 50.
    // The 50 today-events are for a *different* lead so ctx.lead's weekly count stays at 1.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(emailEvents).values({ draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: yesterday });

    const [fillerCo] = await db.insert(companies).values({ name: "Filler Co", industry: "technology", companySize: "small", location: "SG" }).returning();
    const [fillerLead] = await db.insert(leads).values({ companyId: fillerCo.id, email: "filler@filler.com", isVerified: true }).returning();
    const [fillerCampaign] = await db.insert(campaigns).values({ name: "Filler", vertical: "saas", companySizeTarget: "small", status: "active" }).returning();
    await db.insert(campaignLeads).values({ leadId: fillerLead.id, campaignId: fillerCampaign.id });
    const [fillerTemplate] = await db.insert(promptTemplates).values({ name: "Filler Tmpl", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user" }).returning();
    const [fillerDraft] = await db.insert(emailDrafts).values({ leadId: fillerLead.id, campaignId: fillerCampaign.id, templateId: fillerTemplate.id, subject: ".", body: ".", confidenceScore: 70, status: "sent" }).returning();
    await db.insert(emailEvents).values(Array.from({ length: 50 }, () => ({ draftId: fillerDraft.id, leadId: fillerLead.id, sentAt: new Date() })));

    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("queued");
    expect(result.reason).toBe("daily_cap_reached");
  });

  it("paused campaign blocks send", async () => {
    await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, ctx.campaign.id));
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("campaign_status_paused");
  });

  it("draft in pending_review blocks send", async () => {
    await db.update(emailDrafts).set({ status: "pending_review" }).where(eq(emailDrafts.id, ctx.draft.id));
    const result = await sendDraft({ draftId: ctx.draft.id, toEmail: ctx.lead.email, leadId: ctx.lead.id, campaignId: ctx.campaign.id, isVerified: true, hasRiskFlags: false });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("draft_status_pending_review");
  });
});

// ── Approval Workflow ─────────────────────────────────────────────────────────

describe("Approval workflow", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => { await resetTables(); ctx = await seedBase(); });

  async function seedTotalSent(n: number) {
    await db.insert(emailEvents).values(
      Array.from({ length: n }, () => ({ draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() }))
    );
  }

  it("phase 1 (<50 sent): score 85 still goes to review", async () => {
    await seedTotalSent(49);
    expect(await shouldQueueForReview(85)).toBe(true);
  });

  it("phase 1 (<50 sent): score 40 goes to review", async () => {
    await seedTotalSent(49);
    expect(await shouldQueueForReview(40)).toBe(true);
  });

  it("phase 2 (≥50 sent): score 70 is auto-scheduled", async () => {
    await seedTotalSent(50);
    expect(await shouldQueueForReview(70)).toBe(false);
  });

  it("phase 2 (≥50 sent): score 69 goes to review", async () => {
    await seedTotalSent(50);
    expect(await shouldQueueForReview(69)).toBe(true);
  });
});
