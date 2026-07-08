# Pre-Send Gates & Approval Workflow

Tests `sendDraft()` and `shouldQueueForReview()` directly — no cron, no webhook.

---

## Prerequisites

- `TEST_DATABASE_URL` pointing to a separate test database with migrations already applied
- `SES_DRY_RUN=true` so `sendDraft()` writes DB rows without hitting real SES
- Run with: `TEST_DATABASE_URL=... SES_DRY_RUN=true bun test test/pre-send.test.ts`

---

## Code

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, suppressionList, riskFlags, promptTemplates,
} from "../src/db/schema";
import { sendDraft, shouldQueueForReview } from "../src/services/sender";
import { eq, and } from "drizzle-orm";

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetTables() {
  await db.delete(suppressionList);
  await db.delete(riskFlags);
  await db.delete(emailEvents);
  await db.delete(emailDrafts);
  await db.delete(campaignLeads);
  await db.delete(leads);
  await db.delete(campaigns);
  await db.delete(companies);
  await db.delete(promptTemplates);
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seedBase() {
  const [company] = await db.insert(companies).values({
    name: "Acme Corp",
    industry: "technology",
    companySize: "medium",
    location: "Singapore",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "Cold Outreach SG",
    vertical: "saas",
    geography: "SG",
    companySizeTarget: "medium",
    status: "active",
  }).returning();

  const [template] = await db.insert(promptTemplates).values({
    name: "Base Template",
    systemPrompt: "You are a helpful assistant.",
    templateType: "initial",
    active: true,
    createdBy: "user",
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    name: "Alice Tan",
    email: "alice@acme.com",
    role: "Director",
    isVerified: true,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id,
    campaignId: campaign.id,
    templateId: template.id,
    subject: "Quick question for you",
    body: "Hi Alice, I wanted to reach out about...",
    confidenceScore: 80,
    status: "scheduled",
  }).returning();

  return { company, campaign, template, lead, draft };
}

// ── Pre-Send Gate Tests ───────────────────────────────────────────────────────

describe("Pre-send gates", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
  });

  // ── 1. Suppression list ───────────────────────────────────────────────────

  it("blocks send when lead is on suppression list for this campaign", async () => {
    await db.insert(suppressionList).values({
      email: ctx.lead.email,
      campaignId: ctx.campaign.id,
      reason: "manual",
    });

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("suppression_list");
  });

  it("does NOT block send when lead is suppressed for a different campaign", async () => {
    const [otherCampaign] = await db.insert(campaigns).values({
      name: "Other Campaign",
      vertical: "saas",
      geography: "AU",
      companySizeTarget: "medium",
      status: "active",
    }).returning();

    await db.insert(suppressionList).values({
      email: ctx.lead.email,
      campaignId: otherCampaign.id,
      reason: "manual",
    });

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("sent");
  });

  // ── 2. Weekly cap ─────────────────────────────────────────────────────────

  it("blocks send when lead already received 2 emails in the last 7 days", async () => {
    await db.insert(emailEvents).values([
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() },
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: new Date() },
    ]);

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("weekly_cap_reached");
  });

  it("does NOT block send when the 2 previous emails are older than 7 days", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.insert(emailEvents).values([
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: eightDaysAgo },
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: eightDaysAgo },
    ]);

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("sent");
  });

  // ── 3. Risk flags ─────────────────────────────────────────────────────────

  it("blocks send when lead has a risk flag", async () => {
    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: true,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("risk_flags");
  });

  // ── 4. Unverified email ───────────────────────────────────────────────────

  it("blocks send when lead email is not verified", async () => {
    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: false,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("unverified_email");
  });

  // ── 5. Daily warmup cap ───────────────────────────────────────────────────

  it("queues (not blocks) send when daily warmup cap is reached", async () => {
    // First-ever send was yesterday → week 1 → dailyCap = 50.
    // Insert 50 sends today to fill the cap.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date();
    const rows = [
      { draftId: ctx.draft.id, leadId: ctx.lead.id, sentAt: yesterday },
      ...Array.from({ length: 50 }, () => ({
        draftId: ctx.draft.id,
        leadId: ctx.lead.id,
        sentAt: today,
      })),
    ];
    await db.insert(emailEvents).values(rows);

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    // "queued" means it stays in the queue for tomorrow — not a hard block.
    expect(result.status).toBe("queued");
    expect(result.reason).toBe("daily_cap_reached");
  });

  // ── 6. Campaign not active ────────────────────────────────────────────────

  it("blocks send when campaign is paused", async () => {
    await db.update(campaigns)
      .set({ status: "paused" })
      .where(eq(campaigns.id, ctx.campaign.id));

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("campaign_status_paused");
  });

  it("blocks send when campaign is in draft status", async () => {
    await db.update(campaigns)
      .set({ status: "draft" })
      .where(eq(campaigns.id, ctx.campaign.id));

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("campaign_status_draft");
  });

  // ── 7. Draft status ───────────────────────────────────────────────────────

  it("blocks send when draft is still pending_review", async () => {
    await db.update(emailDrafts)
      .set({ status: "pending_review" })
      .where(eq(emailDrafts.id, ctx.draft.id));

    const result = await sendDraft({
      draftId: ctx.draft.id,
      toEmail: ctx.lead.email,
      leadId: ctx.lead.id,
      campaignId: ctx.campaign.id,
      isVerified: true,
      hasRiskFlags: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("draft_status_pending_review");
  });
});

// ── Approval Workflow Tests ───────────────────────────────────────────────────
//
// shouldQueueForReview(score) returns true if the draft should go to manual
// review, false if it should be auto-scheduled.

describe("Approval workflow — phase 1 vs phase 2", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
  });

  // Helper: insert N total sent email_events to set the phase.
  async function seedTotalSent(n: number) {
    await db.insert(emailEvents).values(
      Array.from({ length: n }, () => ({
        draftId: ctx.draft.id,
        leadId: ctx.lead.id,
        sentAt: new Date(),
      }))
    );
  }

  it("phase 1 (<50 total sent): high confidence score still goes to review", async () => {
    await seedTotalSent(49);
    const queued = await shouldQueueForReview(85);
    expect(queued).toBe(true);
  });

  it("phase 1 (<50 total sent): low confidence score goes to review", async () => {
    await seedTotalSent(49);
    const queued = await shouldQueueForReview(40);
    expect(queued).toBe(true);
  });

  it("phase 2 (≥50 total sent): confidence score 70 is auto-scheduled", async () => {
    await seedTotalSent(50);
    const queued = await shouldQueueForReview(70);
    expect(queued).toBe(false);
  });

  it("phase 2 (≥50 total sent): confidence score 69 goes to review", async () => {
    await seedTotalSent(50);
    const queued = await shouldQueueForReview(69);
    expect(queued).toBe(true);
  });

  it("phase 2 boundary: exactly 50 total sent triggers phase 2", async () => {
    await seedTotalSent(50);
    const at69 = await shouldQueueForReview(69);
    const at70 = await shouldQueueForReview(70);
    expect(at69).toBe(true);
    expect(at70).toBe(false);
  });
});
```
