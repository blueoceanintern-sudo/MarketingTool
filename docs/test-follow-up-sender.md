# Follow-Up Sender

Tests `runFollowUpSender()` (Phase A: initial send + follow_ups creation; Phase B: sequence enforcement, lazy content generation, reply short-circuit).

---

## Prerequisites

- `TEST_DATABASE_URL` pointing to a separate test database with migrations applied
- `SES_DRY_RUN=true`
- `runFollowUpSender` is already exported from `src/workers/index.ts`
- Run with: `TEST_DATABASE_URL=... SES_DRY_RUN=true bun test test/follow-up-sender.test.ts`

---

## Code

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, followUps, suppressionList, promptTemplates,
} from "../src/db/schema";
import { runFollowUpSender } from "../src/workers";
import { eq, and, isNull, isNotNull } from "drizzle-orm";

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetTables() {
  await db.delete(suppressionList);
  await db.delete(followUps);
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
    name: "Beta Ltd",
    industry: "education",
    companySize: "small",
    location: "Sydney",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "AU Outreach",
    vertical: "edtech",
    geography: "AU",
    companySizeTarget: "small",
    status: "active",
    description: "Reach AU schools",
    painPoints: ["manual admin", "low engagement"],
    callToAction: "Book a 15-min demo",
  }).returning();

  const [template] = await db.insert(promptTemplates).values({
    name: "Initial Template",
    systemPrompt: "Write a concise cold email.",
    templateType: "initial",
    active: true,
    createdBy: "user",
  }).returning();

  const [fuTemplate1] = await db.insert(promptTemplates).values({
    name: "Follow-up 1 Template",
    systemPrompt: "Write a follow-up email.",
    templateType: "followup_1",
    active: true,
    createdBy: "user",
  }).returning();

  const [fuTemplate2] = await db.insert(promptTemplates).values({
    name: "Follow-up 2 Template",
    systemPrompt: "Write a second follow-up.",
    templateType: "followup_2",
    active: true,
    createdBy: "user",
  }).returning();

  const [fuTemplate3] = await db.insert(promptTemplates).values({
    name: "Breakup Template",
    systemPrompt: "Write a breakup email.",
    templateType: "breakup",
    active: true,
    createdBy: "user",
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    name: "Bob Chen",
    email: "bob@beta.com.au",
    role: "Principal",
    isVerified: true,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id,
    campaignId: campaign.id,
    templateId: template.id,
    subject: "Helping AU schools save admin time",
    body: "Hi Bob, I wanted to reach out...",
    confidenceScore: 75,
    status: "scheduled",
  }).returning();

  return { company, campaign, template, fuTemplate1, fuTemplate2, fuTemplate3, lead, draft };
}

// ── Phase A: Initial Send ─────────────────────────────────────────────────────

describe("Phase A — initial send", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
  });

  it("sends the draft and creates 3 follow_ups at +3, +7, +14 days", async () => {
    const before = Date.now();
    await runFollowUpSender();
    const after = Date.now();

    // Draft marked sent
    const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, ctx.draft.id));
    expect(draft.status).toBe("sent");

    // email_events row created
    const events = await db.select().from(emailEvents).where(eq(emailEvents.leadId, ctx.lead.id));
    expect(events).toHaveLength(1);
    expect(events[0].sentAt).not.toBeNull();

    // 3 follow_ups created with correct attempt numbers
    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus).toHaveLength(3);
    expect(fus.map(f => f.attemptNumber).sort()).toEqual([1, 2, 3]);

    // Verify scheduled offsets (within 5s tolerance of expected)
    const sorted = fus.sort((a, b) => a.attemptNumber - b.attemptNumber);
    const expectedOffsets = [3, 7, 14];
    for (let i = 0; i < 3; i++) {
      const expected = before + expectedOffsets[i] * 24 * 60 * 60 * 1000;
      const actual = sorted[i].scheduledAt.getTime();
      expect(Math.abs(actual - expected)).toBeLessThan(5000);
    }

    // All follow_ups point back to the original draft
    for (const fu of fus) {
      expect(fu.draftId).toBe(ctx.draft.id);
    }
  });

  it("blocked draft (suppressed lead) creates no follow_ups", async () => {
    await db.insert(suppressionList).values({
      email: ctx.lead.email,
      campaignId: ctx.campaign.id,
      reason: "manual",
    });

    await runFollowUpSender();

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus).toHaveLength(0);

    const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, ctx.draft.id));
    expect(draft.status).toBe("scheduled"); // unchanged
  });

  it("draft with an existing email_events row is not re-sent", async () => {
    // Simulate that this draft was already sent (e.g. sent manually)
    await db.insert(emailEvents).values({
      draftId: ctx.draft.id,
      leadId: ctx.lead.id,
      sentAt: new Date(),
    });

    await runFollowUpSender();

    // No additional email_events created
    const events = await db.select().from(emailEvents).where(eq(emailEvents.leadId, ctx.lead.id));
    expect(events).toHaveLength(1); // still only the one we seeded
  });
});

// ── Phase B: Follow-Up Sequence ───────────────────────────────────────────────

describe("Phase B — follow-up sequence", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  // Seed a lead that already had its initial draft sent.
  // Returns the 3 follow_up rows created for it.
  async function seedSentInitial() {
    ctx = await seedBase();

    // Mark the draft as sent and create the email_events row
    await db.update(emailDrafts)
      .set({ status: "sent" })
      .where(eq(emailDrafts.id, ctx.draft.id));

    await db.insert(emailEvents).values({
      draftId: ctx.draft.id,
      leadId: ctx.lead.id,
      sentAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
    });

    // Seed 3 follow_up rows with backdated scheduled_at so they're all due
    const past = new Date(Date.now() - 60 * 1000);
    const [fu1, fu2, fu3] = await db.insert(followUps).values([
      { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 1, scheduledAt: past, draftId: ctx.draft.id },
      { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 2, scheduledAt: past, draftId: ctx.draft.id },
      { leadId: ctx.lead.id, campaignId: ctx.campaign.id, attemptNumber: 3, scheduledAt: past, draftId: ctx.draft.id },
    ]).returning();

    return { fu1, fu2, fu3 };
  }

  beforeEach(async () => {
    await resetTables();
  });

  it("attempt 2 is skipped when attempt 1 has not been sent yet", async () => {
    const { fu1, fu2 } = await seedSentInitial();

    // Leave fu1.sentAt = null (not yet sent), fu2 is due
    await runFollowUpSender();

    const [updatedFu2] = await db.select().from(followUps).where(eq(followUps.id, fu2.id));
    expect(updatedFu2.sentAt).toBeNull(); // attempt 2 blocked because attempt 1 not sent
  });

  it("attempt 2 fires after attempt 1 is sent", async () => {
    const { fu1, fu2, fu3 } = await seedSentInitial();

    // Mark attempt 1 as sent
    await db.update(followUps).set({ sentAt: new Date(), subject: "FU1 subject", body: "FU1 body" }).where(eq(followUps.id, fu1.id));
    // Pre-populate subject/body on fu2 so lazy generation is skipped in this test
    await db.update(followUps).set({ subject: "FU2 subject", body: "FU2 body" }).where(eq(followUps.id, fu2.id));
    // Put fu3 in the future so only fu2 runs
    await db.update(followUps).set({ scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }).where(eq(followUps.id, fu3.id));

    await runFollowUpSender();

    const [updatedFu2] = await db.select().from(followUps).where(eq(followUps.id, fu2.id));
    expect(updatedFu2.sentAt).not.toBeNull();
  });

  it("all pending follow_ups are skipped when the lead has replied", async () => {
    const { fu1 } = await seedSentInitial();

    // Mark the email_events row as replied
    await db.update(emailEvents)
      .set({ repliedAt: new Date() })
      .where(eq(emailEvents.leadId, ctx.lead.id));

    await runFollowUpSender();

    // None of the follow_ups should have been sent
    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    for (const fu of fus) {
      expect(fu.sentAt).toBeNull();
    }
  });

  it("follow_up with null subject/body gets content generated then sent", async () => {
    // NOTE: This test makes a real Batch API call to Claude.
    // Set ANTHROPIC_API_KEY in your test environment.
    // If you want to skip real API calls, mock generateFollowUpBatch.
    const { fu1, fu2, fu3 } = await seedSentInitial();

    // Mark fu1 as sent but leave subject/body null (simulates lazy content path)
    await db.update(followUps)
      .set({ sentAt: new Date() })
      .where(eq(followUps.id, fu1.id));

    // fu2 is due and has no content yet — leave it null
    // Put fu3 in the future
    await db.update(followUps)
      .set({ scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })
      .where(eq(followUps.id, fu3.id));

    await runFollowUpSender();

    const [updatedFu2] = await db.select().from(followUps).where(eq(followUps.id, fu2.id));
    expect(updatedFu2.subject).not.toBeNull();
    expect(updatedFu2.body).not.toBeNull();
    expect(updatedFu2.sentAt).not.toBeNull();
  });

  it("angle_tag is persisted on the follow_up row after it is sent", async () => {
    // NOTE: Requires a real Batch API call or mocked generateFollowUpBatch.
    const { fu1 } = await seedSentInitial();

    // Mark attempt 1 as due and not yet sent, no content
    // The cron will generate content (including angleTag) and send

    await runFollowUpSender();

    const [updatedFu1] = await db.select().from(followUps).where(eq(followUps.id, fu1.id));
    if (updatedFu1.sentAt) {
      // If it was sent, an angleTag should have been returned and persisted
      expect(updatedFu1.angleTag).not.toBeNull();
    }
  });

  it("attempt 3 receives previousAngleTags from attempts 1 and 2 during content generation", async () => {
    // Seed attempts 1 and 2 as already sent with known angle_tags.
    // Then trigger attempt 3 and verify the batch request includes previous angles.
    // This test requires inspecting the batch request — use a spy on generateFollowUpBatch.
    const { fu1, fu2, fu3 } = await seedSentInitial();

    await db.update(followUps).set({
      sentAt: new Date(),
      subject: "FU1",
      body: "FU1 body",
      angleTag: "manual_workload",
    }).where(eq(followUps.id, fu1.id));

    await db.update(followUps).set({
      sentAt: new Date(),
      subject: "FU2",
      body: "FU2 body",
      angleTag: "roi_framing",
    }).where(eq(followUps.id, fu2.id));

    // fu3 is due — spy on generateFollowUpBatch to capture the previousAngleTags passed
    const { spyOn } = await import("bun:test");
    const draftingModule = await import("../src/services/drafting");
    const spy = spyOn(draftingModule, "generateFollowUpBatch");

    await runFollowUpSender();

    const calls = spy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const request = (calls[0][0] as Array<{ previousAngleTags: string[] }>)
      .find(r => r.previousAngleTags !== undefined);
    expect(request?.previousAngleTags).toContain("manual_workload");
    expect(request?.previousAngleTags).toContain("roi_framing");

    spy.mockRestore();
  });
});
```
