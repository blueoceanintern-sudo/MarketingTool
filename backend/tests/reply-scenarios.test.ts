import { mock } from "bun:test";

// mock.module is hoisted before imports — intercepts Claude calls without an API key.
mock.module("../src/services/reply-classifier", () => ({
  classifyReply: async (body: string) => {
    if (/love|set up a call|learn more/i.test(body))
      return { category: "positive", return_date: null, risk_flag: false };
    if (/complaint.*pdpa|pdpa.*complaint|legal team|file a complaint/i.test(body))
      return { category: "negative", return_date: null, risk_flag: true };
    if (/remove me|unsubscribe|not interested/i.test(body))
      return { category: "negative", return_date: null, risk_flag: false };
    if (/out of.*office|out of office/i.test(body)) {
      const dateMatch = body.match(/until (\d{4}-\d{2}-\d{2})/);
      return { category: "out_of_office", return_date: dateMatch?.[1] ?? null, risk_flag: false };
    }
    return { category: "neutral", return_date: null, risk_flag: false };
  },
}));

import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads, emailDrafts, emailEvents,
  followUps, suppressionList, riskFlags, demos, replies, promptTemplates,
} from "../src/db/schema";
import { repliesRouter } from "../src/routes/replies";
import { eq, and, isNull, sql } from "drizzle-orm";

// Mount repliesRouter directly — no auth middleware, no workers import.
const testApp = new Hono();
testApp.route("", repliesRouter);

async function resetTables() {
  await db.execute(sql`TRUNCATE TABLE
    demos, replies, follow_ups, email_events, email_drafts,
    suppression_list, risk_flags, campaign_lead_exclusions, campaign_leads,
    enrichment_records, leads, campaigns, companies, prompt_templates
  CASCADE`);
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildMimeEmail(from: string, body: string, inReplyTo?: string): string {
  return [
    "MIME-Version: 1.0",
    `From: ${from}`,
    "To: outreach@blueocean.com",
    "Subject: Re: Test Email",
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].filter((line) => line !== null).join("\r\n");
}

function buildReceivedEnvelope(fromEmail: string, body: string, sesMessageId: string): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: "arn:aws:sns:ap-southeast-1:123456789012:test",
    Message: JSON.stringify({
      notificationType: "Received",
      mail: {
        messageId: "inbound-" + Date.now(),
        source: fromEmail,
        commonHeaders: {
          from: [`Test <${fromEmail}>`],
          inReplyTo: sesMessageId,
        },
      },
      content: buildMimeEmail(`Test <${fromEmail}>`, body, sesMessageId),
    }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1",
    Signature: "FAKE",
    SigningCertURL: "https://sns.ap-southeast-1.amazonaws.com/fake.pem",
  });
}

function buildComplaintEnvelope(complainedEmail: string): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: crypto.randomUUID(),
    TopicArn: "arn:aws:sns:ap-southeast-1:123456789012:test",
    Message: JSON.stringify({
      notificationType: "Complaint",
      mail: { messageId: "cmp-" + Date.now(), source: "outreach@blueocean.com", commonHeaders: {} },
      complaint: { complainedRecipients: [{ emailAddress: complainedEmail }] },
    }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1",
    Signature: "FAKE",
    SigningCertURL: "https://sns.ap-southeast-1.amazonaws.com/fake.pem",
  });
}

async function postReply(body: string) {
  return testApp.request("/webhooks/ses/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seedBase() {
  const [company] = await db.insert(companies).values({
    name: "Gamma School", industry: "education", companySize: "small", location: "Singapore",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "SG Campaign", vertical: "edtech", geography: "SG", companySizeTarget: "small",
    status: "active", description: "SG schools", painPoints: ["admin overhead"], callToAction: "Book demo",
  }).returning();

  const [template] = await db.insert(promptTemplates).values({
    name: "Initial", systemPrompt: "Write email.", templateType: "initial",
    active: true, createdBy: "user", sendCount: 1,
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id, name: "Carol Lim", email: "carol@gamma.edu.sg",
    role: "Principal", isVerified: true, lastDeliveredTemplateId: template.id,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id, status: "contacted" });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id, campaignId: campaign.id, templateId: template.id,
    subject: "Helping SG schools", body: "Hi Carol...", confidenceScore: 78, status: "sent",
  }).returning();

  const sesMessageId = `<msg-${Date.now()}@email.amazonses.com>`;
  const [event] = await db.insert(emailEvents).values({
    draftId: draft.id, leadId: lead.id, sesMessageId,
    sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  }).returning();

  return { company, campaign, template, lead, draft, event, sesMessageId };
}

// Seed follow_ups for a given scenario.
// Scenario 1: all 3 unsent (initial only sent)
// Scenario 2: fu1 sent, fu2+fu3 unsent and due
// Scenario 3: fu1+fu2 sent, fu3 unsent and due
// Scenario 4: all 3 sent
async function seedFollowUps(leadId: string, campaignId: string, draftId: string, scenario: 1 | 2 | 3 | 4) {
  const now = Date.now();
  const past = new Date(now - 60 * 1000);
  const future = (d: number) => new Date(now + d * 24 * 60 * 60 * 1000);
  const ago = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

  const configs = [
    { sentAt: scenario >= 2 ? ago(3) : null, scheduledAt: scenario >= 2 ? ago(3) : future(3) },
    { sentAt: scenario >= 3 ? ago(7) : null, scheduledAt: scenario >= 3 ? ago(7) : past },
    { sentAt: scenario >= 4 ? ago(14) : null, scheduledAt: scenario >= 4 ? ago(14) : past },
  ];

  return db.insert(followUps).values(
    configs.map((c, i) => ({
      leadId, campaignId, attemptNumber: i + 1,
      scheduledAt: c.scheduledAt, sentAt: c.sentAt, draftId,
      subject: c.sentAt ? `Follow-up ${i + 1}` : null,
      body: c.sentAt ? `Follow-up ${i + 1} body` : null,
    }))
  ).returning();
}

// ── Scenario 1: Reply before day 3 ───────────────────────────────────────────

describe("Scenario 1 — reply before day 3 (initial only sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 1); });

  it("positive reply: demo created, unsent follow_ups deleted, lead converted, positiveIntentCount++", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Yes I'd love to learn more!", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const demoRows = await db.select().from(demos).where(eq(demos.leadId, ctx.lead.id));
    expect(demoRows).toHaveLength(1);

    const unsent = await db.select().from(followUps).where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(unsent).toHaveLength(0);

    const [cl] = await db.select().from(campaignLeads).where(and(eq(campaignLeads.leadId, ctx.lead.id), eq(campaignLeads.campaignId, ctx.campaign.id)));
    expect(cl.status).toBe("converted");

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, ctx.template.id));
    expect(tmpl.positiveIntentCount).toBe(1);
  });

  it("negative plain reply: suppression added, follow_ups deleted, pending_review drafts deleted, NO risk_flag", async () => {
    // A separate unsent draft awaiting review — the sent ctx.draft has email_events so it cannot be deleted.
    await db.insert(emailDrafts).values({
      leadId: ctx.lead.id, campaignId: ctx.campaign.id, templateId: ctx.template.id,
      subject: "Pending", body: "Pending body.", confidenceScore: 60, status: "pending_review",
    });

    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Please remove me from your list.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const supp = await db.select().from(suppressionList).where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(supp).toHaveLength(1);

    const unsent = await db.select().from(followUps).where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    expect(unsent).toHaveLength(0);

    const pending = await db.select().from(emailDrafts).where(and(eq(emailDrafts.leadId, ctx.lead.id), eq(emailDrafts.status, "pending_review")));
    expect(pending).toHaveLength(0);

    const flags = await db.select().from(riskFlags).where(eq(riskFlags.leadId, ctx.lead.id));
    expect(flags).toHaveLength(0);

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, ctx.template.id));
    expect(tmpl.negativeReplyCount).toBe(1);
  });

  it("negative hostile reply: suppression + risk_flag(hostile_interaction)", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Stop emailing me or I will file a complaint with the PDPA authorities and forward this to our legal team.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const supp = await db.select().from(suppressionList).where(eq(suppressionList.email, ctx.lead.email));
    expect(supp).toHaveLength(1);

    const flags = await db.select().from(riskFlags).where(eq(riskFlags.leadId, ctx.lead.id));
    expect(flags).toHaveLength(1);
    expect(flags[0].flagType).toBe("hostile_interaction");
  });

  it("neutral reply: lead marked replied, follow_ups untouched, reply sits unresolved", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Not the right time for us.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const [cl] = await db.select().from(campaignLeads).where(and(eq(campaignLeads.leadId, ctx.lead.id), eq(campaignLeads.campaignId, ctx.campaign.id)));
    expect(cl.status).toBe("replied");

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(fus.filter(f => f.sentAt === null)).toHaveLength(3);

    const replyRows = await db.select().from(replies);
    expect(replyRows[0].sentiment).toBe("neutral");
    expect(replyRows[0].resolvedAt).toBeNull();
  });

  it("OOO with return date: next follow_up rescheduled to stated date", async () => {
    const returnDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const dateStr = returnDate.toISOString().split("T")[0];
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, `I am out of the office until ${dateStr}.`, ctx.sesMessageId));
    expect(res.status).toBe(201);

    const unsent = await db.select().from(followUps).where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    const rescheduled = unsent.sort((a, b) => a.attemptNumber - b.attemptNumber)[0];
    expect(rescheduled.scheduledAt.toISOString().split("T")[0]).toBe(dateStr);
  });

  it("OOO with no date: next follow_up rescheduled to now + 7 days", async () => {
    const before = Date.now();
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "I am currently out of the office.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const unsent = await db.select().from(followUps).where(and(eq(followUps.leadId, ctx.lead.id), isNull(followUps.sentAt)));
    const rescheduled = unsent.sort((a, b) => a.attemptNumber - b.attemptNumber)[0];
    expect(Math.abs(rescheduled.scheduledAt.getTime() - (before + 7 * 24 * 60 * 60 * 1000))).toBeLessThan(5000);
  });
});

// ── Scenario 2: Reply between day 3–7 ────────────────────────────────────────

describe("Scenario 2 — reply between day 3–7 (initial + fu1 sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 2); });

  it("negative reply: deletes only unsent fu2 and fu3 — fu1 (already sent) remains", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Please unsubscribe me.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const all = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(all.find(f => f.attemptNumber === 1)).toBeDefined();
    expect(all.find(f => f.attemptNumber === 2)).toBeUndefined();
    expect(all.find(f => f.attemptNumber === 3)).toBeUndefined();
  });

  it("OOO reply: reschedules fu2 (the next unsent attempt)", async () => {
    const dateStr = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, `Out of office until ${dateStr}.`, ctx.sesMessageId));
    expect(res.status).toBe(201);

    const all = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    const fu2 = all.find(f => f.attemptNumber === 2)!;
    expect(fu2.scheduledAt.toISOString().split("T")[0]).toBe(dateStr);
  });
});

// ── Scenario 3: Reply between day 7–14 ───────────────────────────────────────

describe("Scenario 3 — reply between day 7–14 (initial + fu1 + fu2 sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 3); });

  it("negative reply: only fu3 deleted — fu1 and fu2 remain", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Not interested, remove me.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const all = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(all.find(f => f.attemptNumber === 1)).toBeDefined();
    expect(all.find(f => f.attemptNumber === 2)).toBeDefined();
    expect(all.find(f => f.attemptNumber === 3)).toBeUndefined();
  });
});

// ── Scenario 4: Reply after day 14 ───────────────────────────────────────────

describe("Scenario 4 — reply after day 14 (all follow_ups sent)", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => { await resetTables(); ctx = await seedBase(); await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 4); });

  it("negative reply: suppression added, all 3 sent follow_ups still exist", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Please unsubscribe me.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const supp = await db.select().from(suppressionList).where(eq(suppressionList.email, ctx.lead.email));
    expect(supp).toHaveLength(1);

    const all = await db.select().from(followUps).where(eq(followUps.leadId, ctx.lead.id));
    expect(all).toHaveLength(3);
    for (const fu of all) expect(fu.sentAt).not.toBeNull();
  });

  it("positive reply: demo created", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Let's set up a call.", ctx.sesMessageId));
    expect(res.status).toBe(201);
    const demoRows = await db.select().from(demos).where(eq(demos.leadId, ctx.lead.id));
    expect(demoRows).toHaveLength(1);
  });
});

// ── Multi-Campaign Suppression Scoping ───────────────────────────────────────

describe("Multi-campaign suppression scoping", () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  let campaignBId: string;

  beforeEach(async () => {
    await resetTables();
    ctx = await seedBase();
    await seedFollowUps(ctx.lead.id, ctx.campaign.id, ctx.draft.id, 1);

    const [campB] = await db.insert(campaigns).values({
      name: "Campaign B", vertical: "saas", geography: "AU", companySizeTarget: "small",
      status: "active", description: "AU", painPoints: ["inefficiency"], callToAction: "Demo",
    }).returning();
    campaignBId = campB.id;

    await db.insert(campaignLeads).values({ leadId: ctx.lead.id, campaignId: campaignBId, status: "contacted" });
    await db.insert(emailDrafts).values({
      leadId: ctx.lead.id, campaignId: campaignBId, templateId: ctx.template.id,
      subject: "Campaign B email", body: "Different angle.", confidenceScore: 72, status: "scheduled",
    });
  });

  it("negative reply to campaign A suppresses only A — campaign B draft stays scheduled", async () => {
    const res = await postReply(buildReceivedEnvelope(ctx.lead.email, "Please remove me.", ctx.sesMessageId));
    expect(res.status).toBe(201);

    const suppA = await db.select().from(suppressionList).where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, ctx.campaign.id)));
    expect(suppA).toHaveLength(1);

    const suppB = await db.select().from(suppressionList).where(and(eq(suppressionList.email, ctx.lead.email), eq(suppressionList.campaignId, campaignBId)));
    expect(suppB).toHaveLength(0);

    const [draftB] = await db.select().from(emailDrafts).where(and(eq(emailDrafts.leadId, ctx.lead.id), eq(emailDrafts.campaignId, campaignBId)));
    expect(draftB.status).toBe("scheduled");
  });
});
