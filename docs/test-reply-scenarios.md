# Reply Scenarios

Tests the full webhook reply pipeline for all 4 timing scenarios + multi-campaign suppression scoping.
Each scenario varies which follow_ups have already been sent before the reply arrives.

---

## Prerequisites

- `TEST_DATABASE_URL` pointing to a separate test database with migrations applied
- `SES_DRY_RUN=true`
- `SKIP_SNS_VERIFICATION=true` — add this guard to `src/routes/replies.ts` before calling `verifySnsSignature`:

  ```ts
  // In repliesRouter.post("/webhooks/ses/reply", ...)
  if (process.env.SKIP_SNS_VERIFICATION !== "true") {
    const valid = await verifySnsSignature(raw).catch(() => false);
    if (!valid) return c.json({ error: "Invalid SNS signature" }, 403);
  }
  ```

- The Hono `app` must be exported from `src/index.ts`:
  ```ts
  export { app };
  ```

- Run with: `TEST_DATABASE_URL=... SES_DRY_RUN=true SKIP_SNS_VERIFICATION=true bun test tests/reply-scenarios.test.ts`

---

## Code

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, followUps, suppressionList,
  riskFlags, demos, replies, promptTemplates,
} from "../src/db/schema";
import { app } from "../src/index";
import { eq, and, isNull } from "drizzle-orm";

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetTables() {
  await db.delete(demos);
  await db.delete(replies);
  await db.delete(suppressionList);
  await db.delete(riskFlags);
  await db.delete(followUps);
  await db.delete(emailEvents);
  await db.delete(emailDrafts);
  await db.delete(campaignLeads);
  await db.delete(leads);
  await db.delete(campaigns);
  await db.delete(companies);
  await db.delete(promptTemplates);
}

// ── Builders ──────────────────────────────────────────────────────────────────

// Minimal valid MIME email that PostalMime can parse to extract the text body.
function buildMimeEmail(from: string, body: string, inReplyTo?: string): string {
  const headers = [
    `MIME-Version: 1.0`,
    `From: ${from}`,
    `To: outreach@blueocean.com`,
    `Subject: Re: Test Email`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ].filter(Boolean).join("\r\n");
  return headers;
}

// Wraps a SES Received notification in an SNS envelope.
// With SKIP_SNS_VERIFICATION=true, the Signature fields are ignored.
function buildReceivedEnvelope(fromEmail: string, replyBody: string, sesMessageId: string): string {
  const sesNotification = {
    notificationType: "Received",
    mail: {
      messageId: "inbound-" + Date.now(),
      source: fromEmail,
      commonHeaders: {
        from: [`Test User <${fromEmail}>`],
        inReplyTo: sesMessageId,
      },
    },
    content: buildMimeEmail(`Test User <${fromEmail}>`, replyBody, sesMessageId),
  };

  return JSON.stringify({
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: "arn:aws:sns:ap-southeast-1:123456789012:ses-replies-test",
    Message: JSON.stringify(sesNotification),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1",
    Signature: "FAKE",
    SigningCertURL: "https://sns.ap-southeast-1.amazonaws.com/fake.pem",
  });
}

// Wraps a SES Complaint notification in an SNS envelope.
function buildComplaintEnvelope(complainedEmail: string): string {
  const sesNotification = {
    notificationType: "Complaint",
    mail: {
      messageId: "complaint-" + Date.now(),
      source: "outreach@blueocean.com",
      commonHeaders: {},
    },
    complaint: {
      complainedRecipients: [{ emailAddress: complainedEmail }],
      feedbackId: "feedback-" + Date.now(),
      complaintFeedbackType: "abuse",
    },
  };

  return JSON.stringify({
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: "arn:aws:sns:ap-southeast-1:123456789012:ses-replies-test",
    Message: JSON.stringify(sesNotification),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1",
    Signature: "FAKE",
    SigningCertURL: "https://sns.ap-southeast-1.amazonaws.com/fake.pem",
  });
}

async function postReply(body: string) {
  return app.request("/webhooks/ses/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seedBase() {
  const [company] = await db.insert(companies).values({
    name: "Gamma School",
    industry: "education",
    companySize: "small",
    location: "Singapore",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "SG Schools Campaign",
    vertical: "edtech",
    companySizeTarget: "small",
    status: "active",
    description: "Reach SG schools",
    painPoints: ["admin overhead"],
    callToAction: "Book a demo",
  }).returning();
  // Note: campaign geography is managed via campaign_geos (m:n with geo_places), not a column on campaigns.

  const [template] = await db.insert(promptTemplates).values({
    name: "Initial Template",
    systemPrompt: "Write a cold email.",
    templateType: "initial",
    active: true,
    createdBy: "user",
    sendCount: 1,
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    name: "Carol Lim",
    email: "carol@gamma.edu.sg",
    role: "Principal",
    isVerified: true,
    lastDeliveredTemplateId: template.id,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id, status: "contacted" });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id,
    campaignId: campaign.id,
    templateId: template.id,
    subject: "Helping SG schools",
    body: "Hi Carol...",
    confidenceScore: 78,
    status: "sent",
  }).returning();

  // The initial email was sent — create the email_events row
  const sesMessageId = `<msg-${Date.now()}@email.amazonses.com>`;
  const [event] = await db.insert(emailEvents).values({
    draftId: draft.id,
    leadId: lead.id,
    sesMessageId,
    sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // sent 1 day ago
  }).returning();

  return { company, campaign, template, lead, draft, event, sesMessageId };
}

// Seeds the follow_up rows for a given scenario (1–4) and marks earlier
// attempts as sent so the sequence state matches each scenario.
//
//  Scenario 1: initial sent only         → 3 unsent follow_ups at future dates
//  Scenario 2: initial + fu1 sent        → fu1 sentAt set, fu2/fu3 unsent+due
//  Scenario 3: initial + fu1 + fu2 sent  → fu1/fu2 sentAt set, fu3 unsent+due
//  Scenario 4: all 3 follow_ups sent     → no unsent follow_ups
async function seedFollowUps(
  leadId: string,
  campaignId: string,
  draftId: string,
  scenario: 1 | 2 | 3 | 4,
) {
  const now = Date.now();
  const past = new Date(now - 60 * 1000); // 1 minute ago = due
  const future = (days: number) => new Date(now + days * 24 * 60 * 60 * 1000);

  // Determine sentAt and scheduledAt per attempt for each scenario
  const states: Array<{ sentAt: Date | null; scheduledAt: Date }> = [
    {
      sentAt: scenario >= 2 ? new Date(now - 3 * 24 * 60 * 60 * 1000) : null,
      scheduledAt: scenario >= 2 ? new Date(now - 3 * 24 * 60 * 60 * 1000) : future(3),
    },
    {
      sentAt: scenario >= 3 ? new Date(now - 7 * 24 * 60 * 60 * 1000) : null,
      scheduledAt: scenario >= 3 ? new Date(now - 7 * 24 * 60 * 60 * 1000) : past,
    },
    {
      sentAt: scenario >= 4 ? new Date(now - 14 * 24 * 60 * 60 * 1000) : null,
      scheduledAt: scenario >= 4 ? new Date(now - 14 * 24 * 60 * 60 * 1000) : past,
    },
  ];

  const rows = await db.insert(followUps).values(
    states.map((s, i) => ({
      leadId,
      campaignId,
      attemptNumber: i + 1,
      scheduledAt: s.scheduledAt,
      sentAt: s.sentAt,
      draftId,
      subject: s.sentAt ? `Follow-up ${i + 1}` : null,
      body: s.sentAt ? `Follow-up ${i + 1} body` : null,
    }))
  ).returning();

  return rows;
}

// ── Scenario 1: Reply before day 3 (only initial sent) ───────────────────────

describe("Scenario 1 — reply before day 3 (initial only sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 1);
  });

  it("positive reply: creates demo, deletes unsent follow_ups, marks lead converted, increments positiveIntentCount", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Yes I'd love to learn more!", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    // Demo created
    const demoRows = await db.select().from(demos).where(eq(demos.leadId, ctx.lead.id));
    expect(demoRows).toHaveLength(1);
    expect(demoRows[0].status).toBe("pending");

    // All unsent follow_ups deleted
    const unsent = await db.select().from(followUps)
      .where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(unsent).toHaveLength(0);

    // campaign_leads converted
    const [cl] = await db.select().from(campaignLeads)
      .where(and(eq(campaignLeads.leadId, ctx.lead.id), eq(campaignLeads.campaignId, ctx.campaign.id)));
    expect(cl.status).toBe("converted");

    // Template positiveIntentCount incremented
    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, ctx.template.id));
    expect(tmpl.positiveIntentCount).toBe(1);
  });

  it("negative reply (plain unsubscribe): adds suppression, deletes follow_ups, deletes pending_review drafts, increments negativeReplyCount — NO risk_flag", async () => {
    // Add a pending_review draft to verify it gets deleted
    await db.update(emailDrafts)
      .set({ status: "pending_review" })
      .where(eq(emailDrafts.id, ctx.draft.id));

    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Please remove me from your list.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    // Suppression added (scoped to this campaign)
    const suppRow = await db.select().from(suppressionList)
      .where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(suppRow).toHaveLength(1);

    // Unsent follow_ups deleted
    const unsent = await db.select().from(followUps)
      .where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(unsent).toHaveLength(0);

    // pending_review draft deleted
    const pendingDrafts = await db.select().from(emailDrafts)
      .where(and(eq(emailDrafts.leadId, ctx.lead.id), eq(emailDrafts.status, "pending_review")));
    expect(pendingDrafts).toHaveLength(0);

    // NO risk_flag — this was a plain unsubscribe, not hostile
    const flags = await db.select().from(riskFlags).where(eq(riskFlags.leadId, ctx.lead.id));
    expect(flags).toHaveLength(0);

    // negativeReplyCount incremented on template
    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, ctx.template.id));
    expect(tmpl.negativeReplyCount).toBe(1);

    // campaign_leads suppressed
    const [cl] = await db.select().from(campaignLeads)
      .where(and(eq(campaignLeads.leadId, ctx.lead.id), eq(campaignLeads.campaignId, ctx.campaign.id)));
    expect(cl.status).toBe("suppressed");
  });

  it("negative reply (hostile): all of above PLUS inserts risk_flag(hostile_interaction)", async () => {
    const res = await postReply(
      buildReceivedEnvelope(
        ctx.lead.email,
        "Stop emailing me or I will file a complaint with the PDPA authorities and forward this to our legal team.",
        ctx.sesMessageId
      )
    );
    expect(res.status).toBe(201);

    // Suppression added
    const suppRow = await db.select().from(suppressionList)
      .where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(suppRow).toHaveLength(1);

    // risk_flag inserted
    const flags = await db.select().from(riskFlags).where(eq(riskFlags.leadId, ctx.lead.id));
    expect(flags).toHaveLength(1);
    expect(flags[0].flagType).toBe("hostile_interaction");
  });

  it("neutral reply: lead marked replied, follow_ups untouched, reply sits unresolved in flagged queue", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Not the right time for us right now.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    // campaign_leads status updated to replied
    const [cl] = await db.select().from(campaignLeads)
      .where(and(eq(campaignLeads.leadId, ctx.lead.id), eq(campaignLeads.campaignId, ctx.campaign.id)));
    expect(cl.status).toBe("replied");

    // All follow_ups still exist and unsent
    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus).toHaveLength(3);
    const unsent = fus.filter(f => f.sentAt === null);
    expect(unsent).toHaveLength(3);

    // Reply stored with neutral sentiment and no resolvedAt (sits in flagged queue)
    const replyRows = await db.select().from(replies);
    expect(replyRows).toHaveLength(1);
    expect(replyRows[0].sentiment).toBe("neutral");
    expect(replyRows[0].resolvedAt).toBeNull();
  });

  it("OOO reply with explicit return date: next follow_up rescheduled to stated date", async () => {
    const returnDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const returnDateStr = returnDate.toISOString().split("T")[0]; // YYYY-MM-DD

    const res = await postReply(
      buildReceivedEnvelope(
        ctx.lead.email,
        `I am out of the office until ${returnDateStr}. I will respond when I return.`,
        ctx.sesMessageId
      )
    );
    expect(res.status).toBe(201);

    // The first unsent follow_up should be rescheduled to the return date
    const fus = await db.select().from(followUps)
      .where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(fus.length).toBeGreaterThan(0);

    const rescheduled = fus.sort((a, b) => a.attemptNumber - b.attemptNumber)[0];
    const rescheduledDate = rescheduled.scheduledAt.toISOString().split("T")[0];
    expect(rescheduledDate).toBe(returnDateStr);
  });

  it("OOO reply with no return date: next follow_up rescheduled to now + 7 days", async () => {
    const before = Date.now();

    const res = await postReply(
      buildReceivedEnvelope(
        ctx.lead.email,
        "Hi, I am currently out of the office. I will reply when I am back.",
        ctx.sesMessageId
      )
    );
    expect(res.status).toBe(201);

    const fus = await db.select().from(followUps)
      .where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(fus.length).toBeGreaterThan(0);

    const rescheduled = fus.sort((a, b) => a.attemptNumber - b.attemptNumber)[0];
    const expected7d = before + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(rescheduled.scheduledAt.getTime() - expected7d)).toBeLessThan(5000);
  });
});

// ── Scenario 2: Reply between day 3–7 (initial + follow-up 1 sent) ───────────

describe("Scenario 2 — reply between day 3–7 (initial + fu1 sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 2);
  });

  it("negative reply: deletes only unsent follow_ups 2 and 3 — follow_up 1 (already sent) is untouched", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Please unsubscribe me.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    const allFus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    // follow_up 1 was sent — it should still exist
    const fu1 = allFus.find(f => f.attemptNumber === 1);
    expect(fu1).toBeDefined();
    expect(fu1!.sentAt).not.toBeNull();

    // follow_ups 2 and 3 were unsent — they should be deleted
    const unsent = allFus.filter(f => f.sentAt === null);
    expect(unsent).toHaveLength(0);
  });

  it("OOO reply: reschedules follow_up 2 (the next unsent attempt)", async () => {
    const returnDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const returnDateStr = returnDate.toISOString().split("T")[0];

    const res = await postReply(
      buildReceivedEnvelope(
        ctx.lead.email,
        `Out of office until ${returnDateStr}.`,
        ctx.sesMessageId
      )
    );
    expect(res.status).toBe(201);

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    const fu2 = fus.find(f => f.attemptNumber === 2);
    expect(fu2).toBeDefined();
    expect(fu2!.scheduledAt.toISOString().split("T")[0]).toBe(returnDateStr);
  });
});

// ── Scenario 3: Reply between day 7–14 (initial + fu1 + fu2 sent) ────────────

describe("Scenario 3 — reply between day 7–14 (initial + fu1 + fu2 sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 3);
  });

  it("negative reply: only follow_up 3 is deleted — fu1 and fu2 remain", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Not interested, remove me please.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    const allFus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(allFus.find(f => f.attemptNumber === 1)).toBeDefined();
    expect(allFus.find(f => f.attemptNumber === 2)).toBeDefined();
    expect(allFus.find(f => f.attemptNumber === 3)).toBeUndefined(); // deleted
  });

  it("positive reply: demo created, no unsent follow_ups remain", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Can we get on a call this week?", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    const demoRows = await db.select().from(demos).where(eq(demos.leadId, ctx.lead.id));
    expect(demoRows).toHaveLength(1);

    const unsent = await db.select().from(followUps)
      .where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(unsent).toHaveLength(0);
  });
});

// ── Scenario 4: Reply after day 14 (all 3 follow_ups sent) ───────────────────

describe("Scenario 4 — reply after day 14 (all follow_ups sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 4);
  });

  it("negative reply: no follow_ups to delete (all already sent), suppression still added", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Please unsubscribe me.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    const supp = await db.select().from(suppressionList)
      .where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(supp).toHaveLength(1);

    // All 3 follow_ups still exist with their sentAt intact
    const allFus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(allFus).toHaveLength(3);
    for (const fu of allFus) {
      expect(fu.sentAt).not.toBeNull();
    }
  });

  it("positive reply: demo created, no unsent follow_ups existed to delete", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Let's set up that call.", ctx.sesMessageId)
    );
    expect(res.status).toBe(201);

    const demoRows = await db.select().from(demos).where(eq(demos.leadId, ctx.lead.id));
    expect(demoRows).toHaveLength(1);
  });
});

// ── Multi-Campaign Suppression Scoping ───────────────────────────────────────
//
// A negative reply to Campaign A must NOT suppress the lead for Campaign B.

describe("Multi-campaign suppression scoping", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  let campaignB: typeof ctx.campaign;
  let draftB: typeof ctx.draft;
  let sesMessageIdA: string;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();

    // Enrol the same lead in a second campaign
    const [camp] = await db.insert(campaigns).values({
      name: "Campaign B",
      vertical: "saas",
      companySizeTarget: "small",
      status: "active",
      description: "AU outreach",
      painPoints: ["inefficiency"],
      callToAction: "Book demo",
    }).returning();
    campaignB = camp;

    await db.insert(campaignLeads).values({
      leadId: ctx.lead.id,
      campaignId: campaignB.id,
      status: "contacted",
    });

    const [draftBRow] = await db.insert(emailDrafts).values({
      leadId: ctx.lead.id,
      campaignId: campaignB.id,
      templateId: ctx.template.id,
      subject: "Campaign B email",
      body: "Hi Carol, different angle...",
      confidenceScore: 72,
      status: "scheduled",
    }).returning();
    draftB = draftBRow;

    sesMessageIdA = ctx.sesMessageId;
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 1);
  });

  it("negative reply to campaign A suppresses only campaign A — campaign B unaffected", async () => {
    const res = await postReply(
      buildReceivedEnvelope(ctx.lead.email, "Please remove me from your list.", sesMessageIdA)
    );
    expect(res.status).toBe(201);

    // Suppressed for campaign A
    const suppA = await db.select().from(suppressionList)
      .where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(suppA).toHaveLength(1);

    // NOT suppressed for campaign B
    const suppB = await db.select().from(suppressionList)
      .where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, campaignB.id)));
    expect(suppB).toHaveLength(0);

    // Draft for campaign B is still in scheduled state — can still be sent
    const [draftBState] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftB.id));
    expect(draftBState.status).toBe("scheduled");
  });
});
```
