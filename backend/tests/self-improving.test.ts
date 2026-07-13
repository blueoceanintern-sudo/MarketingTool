import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { Hono } from "hono";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, promptTemplates,
} from "../src/db/schema";
import { repliesRouter } from "../src/routes/replies";
import { runMutationRunner } from "../src/workers";
import { eq, inArray, sql } from "drizzle-orm";

const testApp = new Hono();
testApp.route("", repliesRouter);

async function resetTables() {
  await db.execute(sql`TRUNCATE TABLE
    demos, replies, follow_ups, email_events, email_drafts,
    suppression_list, risk_flags, campaign_lead_exclusions, campaign_leads,
    enrichment_records, leads, campaigns, companies, prompt_templates
  CASCADE`);
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

async function postComplaint(email: string) {
  return testApp.request("/webhooks/ses/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: buildComplaintEnvelope(email),
  });
}

// Seed a lead whose lastDeliveredTemplateId points to the given template.
async function seedComplainant(templateId: string, email: string) {
  const [company] = await db.insert(companies).values({
    name: "Complainant Co", industry: "technology", companySize: "medium", location: "Singapore",
  }).returning();
  return db.insert(leads).values({
    companyId: company.id, name: "Complainer", email,
    isVerified: true, lastDeliveredTemplateId: templateId,
  }).returning();
}

// Seed a template lineage 4 levels deep: root → child → grandchild → great-grandchild.
// Root is seeded with 2 existing spam complaints + sendCount=2000 so the NEXT complaint triggers the kill.
async function seedLineage() {
  const [root] = await db.insert(promptTemplates).values({
    name: "Root", systemPrompt: "Root.", templateType: "initial",
    active: true, createdBy: "user", generationDepth: 0,
    sendCount: 2000, spamComplaintCount: 2,
  }).returning();

  const [child] = await db.insert(promptTemplates).values({
    name: "Child", systemPrompt: "Child.", templateType: "initial",
    active: true, createdBy: "ai", generationDepth: 1, parentTemplateId: root.id,
  }).returning();

  const [grandchild] = await db.insert(promptTemplates).values({
    name: "Grandchild", systemPrompt: "Grandchild.", templateType: "initial",
    active: true, createdBy: "ai", generationDepth: 2, parentTemplateId: child.id,
  }).returning();

  const [greatGrandchild] = await db.insert(promptTemplates).values({
    name: "GreatGrandchild", systemPrompt: "GGC.", templateType: "initial",
    active: true, createdBy: "ai", generationDepth: 3, parentTemplateId: grandchild.id,
  }).returning();

  const [siblingRoot] = await db.insert(promptTemplates).values({
    name: "Sibling Root", systemPrompt: "Sibling.", templateType: "initial",
    active: true, createdBy: "user", generationDepth: 0, sendCount: 500,
  }).returning();

  const [siblingChild] = await db.insert(promptTemplates).values({
    name: "Sibling Child", systemPrompt: "Sibling child.", templateType: "initial",
    active: true, createdBy: "ai", generationDepth: 1, parentTemplateId: siblingRoot.id,
  }).returning();

  return { root, child, grandchild, greatGrandchild, siblingRoot, siblingChild };
}

// Seed enough email_events to push totalSent above the threshold.
async function seedTotalSent(n: number) {
  const [company] = await db.insert(companies).values({ name: "Vol Co", industry: "technology", companySize: "medium", location: "Singapore" }).returning();
  const [campaign] = await db.insert(campaigns).values({ name: "Vol", vertical: "saas", companySizeTarget: "medium", status: "active" }).returning();
  const [template] = await db.insert(promptTemplates).values({ name: "Vol Tmpl", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user" }).returning();
  const [lead] = await db.insert(leads).values({ companyId: company.id, email: "vol@test.com", isVerified: true }).returning();
  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });
  const [draft] = await db.insert(emailDrafts).values({ leadId: lead.id, campaignId: campaign.id, templateId: template.id, subject: ".", body: ".", confidenceScore: 70, status: "sent" }).returning();
  await db.insert(emailEvents).values(Array.from({ length: n }, () => ({ draftId: draft.id, leadId: lead.id, sentAt: new Date() })));
}

const MOCK_MUTATION = {
  name: "Test Mutation", description: "A test variant.",
  systemPrompt: "New system prompt.",
  mutationMode: "replace" as const,
  parentPersuasionStrategy: "pain/problem",
  childPersuasionStrategy: "revenue_growth",
  dimensionsChanged: ["opening pattern", "CTA framing", "proof mechanism", "narrative structure"],
  mutationDistance: "high",
  mutationReason: "Testing revenue framing.",
  hypothesisTested: "Revenue framing beats pain framing.",
};

// ── Kill-Switch ───────────────────────────────────────────────────────────────

describe("Spam complaint kill-switch", () => {
  let lineage: Awaited<ReturnType<typeof seedLineage>>;
  beforeEach(async () => { await resetTables(); lineage = await seedLineage(); });

  it("below threshold (rate 0.06%): no kill fires", async () => {
    await db.update(promptTemplates).set({ sendCount: 5000, spamComplaintCount: 2 }).where(eq(promptTemplates.id, lineage.root.id));
    await seedComplainant(lineage.root.id, "c1@test.com");
    await postComplaint("c1@test.com");

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(3);
    expect(tmpl.active).toBe(true);
  });

  it("at threshold (3 complaints, rate 0.15%): kill fires", async () => {
    await seedComplainant(lineage.root.id, "c2@test.com");
    await postComplaint("c2@test.com");

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(3);
    expect(tmpl.active).toBe(false);
  });

  it("kill deactivates root + child + grandchild + great-grandchild", async () => {
    await seedComplainant(lineage.root.id, "c3@test.com");
    await postComplaint("c3@test.com");

    const family = await db.select({ id: promptTemplates.id, active: promptTemplates.active })
      .from(promptTemplates)
      .where(inArray(promptTemplates.id, [lineage.root.id, lineage.child.id, lineage.grandchild.id, lineage.greatGrandchild.id]));

    expect(family).toHaveLength(4);
    for (const t of family) expect(t.active).toBe(false);
  });

  it("kill does NOT affect a separate sibling lineage", async () => {
    await seedComplainant(lineage.root.id, "c4@test.com");
    await postComplaint("c4@test.com");

    const siblings = await db.select({ id: promptTemplates.id, active: promptTemplates.active })
      .from(promptTemplates)
      .where(inArray(promptTemplates.id, [lineage.siblingRoot.id, lineage.siblingChild.id]));

    for (const t of siblings) expect(t.active).toBe(true);
  });

  it("complaint on lead with no lastDeliveredTemplateId is silently ignored", async () => {
    const [company] = await db.insert(companies).values({ name: "No Tmpl Co", industry: "technology", companySize: "small", location: "Singapore" }).returning();
    await db.insert(leads).values({ companyId: company.id, email: "notmpl@test.com", isVerified: true });
    const res = await postComplaint("notmpl@test.com");
    expect(res.status).toBe(200);

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(2);
  });
});

// ── Mutation Runner ───────────────────────────────────────────────────────────

describe("Mutation runner", () => {
  beforeEach(async () => { await resetTables(); });

  async function seedPool(count = 10, sendCount = 100, overrides: Record<number, Partial<typeof promptTemplates.$inferInsert>> = {}) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const [t] = await db.insert(promptTemplates).values({
        name: `Template ${i}`, systemPrompt: `Prompt ${i}.`, templateType: "initial",
        active: true, createdBy: "user", generationDepth: 0, sendCount,
        positiveIntentCount: Math.floor(sendCount * (1 - i / count)),
        ...overrides[i],
      }).returning();
      rows.push(t);
    }
    return rows;
  }

  it("skips entirely when totalSent < 300", async () => {
    await seedTotalSent(299);
    await seedPool();
    const before = (await db.select().from(promptTemplates)).length;
    await runMutationRunner();
    const after = (await db.select().from(promptTemplates)).length;
    expect(after).toBe(before);
  });

  it("skips template type when fewer than 2 eligible templates exist", async () => {
    await seedTotalSent(300);
    await db.insert(promptTemplates).values({ name: "Only", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user", sendCount: 100 });
    const before = (await db.select().from(promptTemplates)).length;
    await runMutationRunner();
    const after = (await db.select().from(promptTemplates)).length;
    expect(after).toBe(before);
  });

  it("active=false templates are excluded as mutation candidates", async () => {
    await seedTotalSent(300);
    const [inactive] = await db.insert(promptTemplates).values({ name: "Inactive", systemPrompt: ".", templateType: "initial", active: false, createdBy: "user", sendCount: 200 }).returning();
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION);
    await seedPool(2);
    await runMutationRunner();
    const calledWithIds = spy.mock.calls.map(c => c[0] as string);
    expect(calledWithIds).not.toContain(inactive.id);
    spy.mockRestore();
  });

  it("generationDepth=5 templates are excluded", async () => {
    await seedTotalSent(300);
    const [deep] = await db.insert(promptTemplates).values({ name: "Depth5", systemPrompt: ".", templateType: "initial", active: true, createdBy: "ai", generationDepth: 5, sendCount: 200 }).returning();
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION);
    await seedPool(2);
    await runMutationRunner();
    const calledWithIds = spy.mock.calls.map(c => c[0] as string);
    expect(calledWithIds).not.toContain(deep.id);
    spy.mockRestore();
  });

  it("sendCount<50 templates are excluded", async () => {
    await seedTotalSent(300);
    const [low] = await db.insert(promptTemplates).values({ name: "LowSend", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user", sendCount: 49 }).returning();
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION);
    await seedPool(2);
    await runMutationRunner();
    const calledWithIds = spy.mock.calls.map(c => c[0] as string);
    expect(calledWithIds).not.toContain(low.id);
    spy.mockRestore();
  });

  it("AI-generated template (createdBy=ai, depth=2, sendCount=50) IS now eligible", async () => {
    await seedTotalSent(300);
    const [aiTmpl] = await db.insert(promptTemplates).values({ name: "AI Depth2", systemPrompt: ".", templateType: "initial", active: true, createdBy: "ai", generationDepth: 2, sendCount: 50, positiveIntentCount: 2 }).returning();
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION);
    await seedPool(2);
    await runMutationRunner();
    const calledWithIds = spy.mock.calls.map(c => c[0] as string);
    expect(calledWithIds).toContain(aiTmpl.id);
    spy.mockRestore();
  });

  it("bottom 25% candidate: replace mutation inserted with correct DB fields", async () => {
    await seedTotalSent(300);
    await seedPool(10, 100);
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION);

    await runMutationRunner();

    const mutations = await db.select().from(promptTemplates).where(eq(promptTemplates.createdBy, "ai"));
    const replaceMut = mutations.find(m => m.mutationMode === "replace");
    expect(replaceMut).toBeDefined();
    expect(replaceMut!.active).toBe(true);
    expect(replaceMut!.generationDepth).toBe(1);
    expect(replaceMut!.childPersuasionStrategy).toBe("revenue_growth");
    expect(replaceMut!.childPersuasionStrategy).not.toBe(replaceMut!.parentPersuasionStrategy);

    spy.mockRestore();
  });

  it("depth=4 parent produces depth=5 child — child is then ineligible in next run", async () => {
    await seedTotalSent(300);
    const [depth4] = await db.insert(promptTemplates).values({ name: "Depth4", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user", generationDepth: 4, sendCount: 100, positiveIntentCount: 5 }).returning();
    await db.insert(promptTemplates).values({ name: "TopPerformer", systemPrompt: ".", templateType: "initial", active: true, createdBy: "user", generationDepth: 0, sendCount: 100, positiveIntentCount: 80 });

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue({ ...MOCK_MUTATION, mutationMode: "replace" });

    await runMutationRunner();

    const [child] = await db.select().from(promptTemplates).where(eq(promptTemplates.parentTemplateId, depth4.id));
    expect(child).toBeDefined();
    expect(child.generationDepth).toBe(5);

    spy.mockReset();
    await runMutationRunner();

    const calledWithIds = spy.mock.calls.map(c => c[0] as string);
    expect(calledWithIds).not.toContain(child.id);

    spy.mockRestore();
  });
});
