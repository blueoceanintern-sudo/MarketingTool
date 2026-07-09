# Self-Improving Templates

Tests the spam complaint kill-switch (via webhook) and the mutation runner (via direct function call).

---

## Prerequisites

- `TEST_DATABASE_URL` pointing to a separate test database with migrations applied
- `SES_DRY_RUN=true`
- `SKIP_SNS_VERIFICATION=true` (same guard as in `test-reply-scenarios.md`)
- The Hono `app` exported from `src/index.ts`
- **`runMutationRunner` must be exported from `src/workers/index.ts`:**

  ```ts
  // In src/workers/index.ts — extract the cron body to a named export
  export async function runMutationRunner() {
    // ... (the existing cron body)
  }
  cron.schedule("0 6 * * 1", runMutationRunner);
  ```

- For mutation tests: either set `ANTHROPIC_API_KEY` (real Claude calls) or mock
  `generateMutation` from `src/services/mutator/index.ts` as shown below.

- Run with: `TEST_DATABASE_URL=... SES_DRY_RUN=true SKIP_SNS_VERIFICATION=true bun test test/self-improving.test.ts`

---

## Code

```ts
import { describe, it, expect, beforeEach, spyOn, mock } from "bun:test";
import { db } from "../src/db";
import {
  companies, campaigns, leads, campaignLeads,
  emailDrafts, emailEvents, promptTemplates, suppressionList,
} from "../src/db/schema";
import { app } from "../src/index";
import { runMutationRunner } from "../src/workers";
import { eq, and, inArray } from "drizzle-orm";

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetTables() {
  await db.delete(suppressionList);
  await db.delete(emailEvents);
  await db.delete(emailDrafts);
  await db.delete(campaignLeads);
  await db.delete(leads);
  await db.delete(campaigns);
  await db.delete(companies);
  await db.delete(promptTemplates);
}

// ── Builders ─────────────────────────────────────────────────────────────────

// SNS complaint notification envelope.
// With SKIP_SNS_VERIFICATION=true, the Signature fields are ignored.
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

async function postComplaint(email: string) {
  return app.request("/webhooks/ses/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: buildComplaintEnvelope(email),
  });
}

// ── Kill-Switch Seed ──────────────────────────────────────────────────────────
//
// Builds a template lineage: root → child → grandchild → great-grandchild.
// Also creates a sibling root (separate lineage) to verify isolation.

async function seedTemplateLineage() {
  const [root] = await db.insert(promptTemplates).values({
    name: "Root Template",
    systemPrompt: "Root system prompt.",
    templateType: "initial",
    active: true,
    createdBy: "user",
    generationDepth: 0,
    sendCount: 2000,
    spamComplaintCount: 2, // 1 more complaint will trigger the kill (3 ≥ 3, rate 0.15% ≥ 0.1%)
  }).returning();

  const [child] = await db.insert(promptTemplates).values({
    name: "Child Template",
    systemPrompt: "Child system prompt.",
    templateType: "initial",
    active: true,
    createdBy: "ai",
    generationDepth: 1,
    parentTemplateId: root.id,
    sendCount: 100,
  }).returning();

  const [grandchild] = await db.insert(promptTemplates).values({
    name: "Grandchild Template",
    systemPrompt: "Grandchild system prompt.",
    templateType: "initial",
    active: true,
    createdBy: "ai",
    generationDepth: 2,
    parentTemplateId: child.id,
    sendCount: 50,
  }).returning();

  const [greatGrandchild] = await db.insert(promptTemplates).values({
    name: "Great-Grandchild Template",
    systemPrompt: "Great-grandchild system prompt.",
    templateType: "initial",
    active: true,
    createdBy: "ai",
    generationDepth: 3,
    parentTemplateId: grandchild.id,
    sendCount: 20,
  }).returning();

  // Sibling lineage — completely separate from root
  const [siblingRoot] = await db.insert(promptTemplates).values({
    name: "Sibling Root",
    systemPrompt: "Sibling root prompt.",
    templateType: "initial",
    active: true,
    createdBy: "user",
    generationDepth: 0,
    sendCount: 500,
    spamComplaintCount: 0,
  }).returning();

  const [siblingChild] = await db.insert(promptTemplates).values({
    name: "Sibling Child",
    systemPrompt: "Sibling child prompt.",
    templateType: "initial",
    active: true,
    createdBy: "ai",
    generationDepth: 1,
    parentTemplateId: siblingRoot.id,
    sendCount: 60,
  }).returning();

  return { root, child, grandchild, greatGrandchild, siblingRoot, siblingChild };
}

// Creates a lead with lastDeliveredTemplateId pointing to the given template,
// so the complaint handler knows which template to increment + potentially kill.
async function seedComplainantLead(templateId: string, emailAddress: string) {
  const [company] = await db.insert(companies).values({
    name: "Complainant Co",
    industry: "technology",
    companySize: "medium",
    location: "Singapore",
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    name: "Complainer",
    email: emailAddress,
    role: "Manager",
    isVerified: true,
    lastDeliveredTemplateId: templateId,
  }).returning();

  return lead;
}

// ── Kill-Switch Tests ─────────────────────────────────────────────────────────

describe("Spam complaint kill-switch", () => {
  let lineage: Awaited<ReturnType<typeof seedTemplateLineage>>;

  beforeEach(async () => {
    await resetTables();
    lineage = await seedTemplateLineage();
  });

  it("below threshold (2 complaints, sendCount=5000, rate=0.04%): no kill fires", async () => {
    // Root with 2 complaints and 5000 sends — rate is 0.04%, below 0.1%
    await db.update(promptTemplates).set({ sendCount: 5000, spamComplaintCount: 2 })
      .where(eq(promptTemplates.id, lineage.root.id));

    await seedComplainantLead(lineage.root.id, "complainer1@test.com");
    const res = await postComplaint("complainer1@test.com");
    expect(res.status).toBe(200);

    // After 3rd complaint: spamComplaintCount=3, rate=3/5000=0.06% — still below 0.1%
    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(3);
    expect(tmpl.active).toBe(true); // NOT killed
  });

  it("below threshold (2 complaints, sendCount=2000): 3rd complaint at 0.15% triggers kill", async () => {
    // Root already seeded with spamComplaintCount=2, sendCount=2000
    await seedComplainantLead(lineage.root.id, "complainer2@test.com");
    const res = await postComplaint("complainer2@test.com");
    expect(res.status).toBe(200);

    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(3);
    expect(tmpl.active).toBe(false); // killed
  });

  it("kill-switch deactivates the root template and ALL descendants (full lineage)", async () => {
    await seedComplainantLead(lineage.root.id, "complainer3@test.com");
    await postComplaint("complainer3@test.com");

    const familyIds = [
      lineage.root.id,
      lineage.child.id,
      lineage.grandchild.id,
      lineage.greatGrandchild.id,
    ];

    const family = await db.select({ id: promptTemplates.id, active: promptTemplates.active })
      .from(promptTemplates)
      .where(inArray(promptTemplates.id, familyIds));

    expect(family).toHaveLength(4);
    for (const t of family) {
      expect(t.active).toBe(false);
    }
  });

  it("kill-switch does NOT affect a separate sibling lineage", async () => {
    await seedComplainantLead(lineage.root.id, "complainer4@test.com");
    await postComplaint("complainer4@test.com");

    // Sibling root and its child should still be active
    const siblings = await db.select({ id: promptTemplates.id, active: promptTemplates.active })
      .from(promptTemplates)
      .where(inArray(promptTemplates.id, [lineage.siblingRoot.id, lineage.siblingChild.id]));

    for (const t of siblings) {
      expect(t.active).toBe(true);
    }
  });

  it("complaint on lead with no lastDeliveredTemplateId is silently ignored", async () => {
    // Lead has no lastDeliveredTemplateId set
    const [company] = await db.insert(companies).values({
      name: "No Template Co",
      industry: "technology",
      companySize: "small",
      location: "Singapore",
    }).returning();
    await db.insert(leads).values({
      companyId: company.id,
      name: "No Template Lead",
      email: "notemplate@test.com",
      isVerified: true,
      // lastDeliveredTemplateId intentionally omitted
    });

    const res = await postComplaint("notemplate@test.com");
    expect(res.status).toBe(200); // handled gracefully, no crash

    // Root template unchanged
    const [tmpl] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, lineage.root.id));
    expect(tmpl.spamComplaintCount).toBe(2); // still at seed value
  });
});

// ── Mutation Runner Seed ──────────────────────────────────────────────────────

// Builds a pool of prompt_templates of type "initial" with varied positive rates
// so we can test all percentile tiers.
//
// Pool: 10 templates with descending positive rates so rank is deterministic.
//   rank 0  → positiveRate = 1.0  (top 5%  → refine 1 dim)
//   rank 1  → positiveRate = 0.8  (top 25% → refine 2 dim or replace)
//   rank 2  → positiveRate = 0.7
//   ...
//   rank 7  → positiveRate = 0.3  (middle 50% → skip)
//   rank 8  → positiveRate = 0.2  (bottom 25% → replace candidate)
//   rank 9  → positiveRate = 0.1  (absolute worst → replace candidate)

async function seedMutationPool({
  count = 10,
  sendCount = 100,
  type = "initial" as const,
  overrides: overridesMap = {} as Record<number, Partial<typeof promptTemplates.$inferInsert>>,
} = {}) {
  const templates = [];
  for (let i = 0; i < count; i++) {
    const positiveIntentCount = Math.floor(sendCount * (1 - i / count));
    const base = {
      name: `Template ${i}`,
      systemPrompt: `System prompt for template ${i}.`,
      templateType: type,
      active: true,
      createdBy: "user" as const,
      generationDepth: 0,
      sendCount,
      positiveIntentCount,
    };
    const [t] = await db.insert(promptTemplates).values({ ...base, ...overridesMap[i] }).returning();
    templates.push(t);
  }
  return templates;
}

// Insert enough email_events to push totalSent above 300.
async function seedTotalSent(n: number) {
  const [company] = await db.insert(companies).values({
    name: "Volume Co",
    industry: "technology",
    companySize: "medium",
    location: "Singapore",
  }).returning();

  const [campaign] = await db.insert(campaigns).values({
    name: "Volume Campaign",
    vertical: "saas",
    geography: "SG",
    companySizeTarget: "medium",
    status: "active",
  }).returning();

  const [template] = await db.insert(promptTemplates).values({
    name: "Volume Template",
    systemPrompt: "Volume prompt.",
    templateType: "initial",
    active: true,
    createdBy: "user",
  }).returning();

  const [lead] = await db.insert(leads).values({
    companyId: company.id,
    name: "Volume Lead",
    email: "volume@test.com",
    isVerified: true,
  }).returning();

  await db.insert(campaignLeads).values({ leadId: lead.id, campaignId: campaign.id });

  const [draft] = await db.insert(emailDrafts).values({
    leadId: lead.id,
    campaignId: campaign.id,
    templateId: template.id,
    subject: "Volume",
    body: "Volume body",
    confidenceScore: 70,
    status: "sent",
  }).returning();

  await db.insert(emailEvents).values(
    Array.from({ length: n }, () => ({
      draftId: draft.id,
      leadId: lead.id,
      sentAt: new Date(),
    }))
  );
}

// A fixture MutationResult returned by the mocked generateMutation call.
const MOCK_MUTATION_RESULT = {
  name: "Test Mutation",
  description: "A test mutation variant.",
  systemPrompt: "You are helpful. New system prompt.",
  mutationMode: "replace" as const,
  parentPersuasionStrategy: "pain/problem",
  childPersuasionStrategy: "revenue_growth",
  dimensionsChanged: ["opening pattern", "CTA framing", "proof mechanism", "narrative structure"],
  mutationDistance: "high",
  mutationReason: "Testing a new revenue framing hypothesis.",
  hypothesisTested: "Revenue framing will outperform pain framing for this persona.",
};

// ── Mutation Runner Tests ─────────────────────────────────────────────────────

describe("Mutation runner", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("skips entirely when totalSent < 300", async () => {
    await seedTotalSent(299);
    await seedMutationPool();

    // No mutations should be inserted even though the pool is ready
    const countBefore = await db.select().from(promptTemplates);
    await runMutationRunner();
    const countAfter = await db.select().from(promptTemplates);

    expect(countAfter.length).toBe(countBefore.length);
  });

  it("skips a template type when fewer than 2 eligible templates exist for it", async () => {
    await seedTotalSent(300);
    // Only 1 eligible template — not enough to compute a meaningful percentile
    await db.insert(promptTemplates).values({
      name: "Only Template",
      systemPrompt: "Only one.",
      templateType: "initial",
      active: true,
      createdBy: "user",
      generationDepth: 0,
      sendCount: 100,
      positiveIntentCount: 50,
    });

    const countBefore = (await db.select().from(promptTemplates)).length;
    await runMutationRunner();
    const countAfter = (await db.select().from(promptTemplates)).length;

    expect(countAfter).toBe(countBefore); // no mutation inserted
  });

  it("eligible filter: active=false templates are excluded as mutation candidates", async () => {
    await seedTotalSent(300);

    // Seed 2 active + 1 inactive. Runner should only see 2 eligible.
    const [inactive] = await db.insert(promptTemplates).values({
      name: "Inactive Template",
      systemPrompt: "Inactive.",
      templateType: "initial",
      active: false, // not eligible
      createdBy: "user",
      generationDepth: 0,
      sendCount: 200,
      positiveIntentCount: 100,
    }).returning();

    // Spy on generateMutation to capture which candidates are selected
    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION_RESULT);

    await seedMutationPool({ count: 2 }); // 2 active templates
    await runMutationRunner();

    // generateMutation should never have been called with the inactive template's id
    const calledWithIds = spy.mock.calls.map(call => call[0] as string);
    expect(calledWithIds).not.toContain(inactive.id);

    spy.mockRestore();
  });

  it("eligible filter: templates with generationDepth=5 are excluded", async () => {
    await seedTotalSent(300);

    const [depth5] = await db.insert(promptTemplates).values({
      name: "Depth 5 Template",
      systemPrompt: "Too deep.",
      templateType: "initial",
      active: true,
      createdBy: "ai",
      generationDepth: 5, // at the limit — not eligible
      sendCount: 200,
      positiveIntentCount: 100,
    }).returning();

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION_RESULT);

    await seedMutationPool({ count: 2 });
    await runMutationRunner();

    const calledWithIds = spy.mock.calls.map(call => call[0] as string);
    expect(calledWithIds).not.toContain(depth5.id);

    spy.mockRestore();
  });

  it("eligible filter: templates with sendCount<50 are excluded", async () => {
    await seedTotalSent(300);

    const [lowSend] = await db.insert(promptTemplates).values({
      name: "Low Send Template",
      systemPrompt: "Not enough sends.",
      templateType: "initial",
      active: true,
      createdBy: "user",
      generationDepth: 0,
      sendCount: 49, // below threshold
      positiveIntentCount: 30,
    }).returning();

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION_RESULT);

    await seedMutationPool({ count: 2 });
    await runMutationRunner();

    const calledWithIds = spy.mock.calls.map(call => call[0] as string);
    expect(calledWithIds).not.toContain(lowSend.id);

    spy.mockRestore();
  });

  it("eligible filter: AI-generated template with depth=2 and sendCount=50 IS now eligible (our change)", async () => {
    await seedTotalSent(300);

    // This template was blocked before our change (createdBy='ai' was excluded).
    // Now it must be included in the eligible pool.
    const [aiTemplate] = await db.insert(promptTemplates).values({
      name: "AI Template Depth 2",
      systemPrompt: "AI generated, depth 2.",
      templateType: "initial",
      active: true,
      createdBy: "ai",
      generationDepth: 2,
      sendCount: 50,
      positiveIntentCount: 5,
    }).returning();

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION_RESULT);

    await seedMutationPool({ count: 2 }); // 2 more human templates to meet minimum 2
    await runMutationRunner();

    // The AI template should appear in at least one generateMutation call as a candidate
    // (it's in the bottom 25% given its low positive rate, so it will be the replace candidate)
    const calledWithIds = spy.mock.calls.map(call => call[0] as string);
    expect(calledWithIds).toContain(aiTemplate.id);

    spy.mockRestore();
  });

  it("bottom 25% candidate: generates a replace mutation with correct DB fields", async () => {
    await seedTotalSent(300);
    const pool = await seedMutationPool({ count: 10, sendCount: 100 });

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue(MOCK_MUTATION_RESULT);

    await runMutationRunner();

    // At least one mutation should have been inserted
    const mutations = await db.select().from(promptTemplates)
      .where(eq(promptTemplates.createdBy, "ai"));

    // Find the one from the replace path
    const replaceMutation = mutations.find(m => m.mutationMode === "replace");
    expect(replaceMutation).toBeDefined();
    expect(replaceMutation!.active).toBe(true);
    expect(replaceMutation!.generationDepth).toBe(1);
    expect(replaceMutation!.parentPersuasionStrategy).toBe("pain/problem");
    expect(replaceMutation!.childPersuasionStrategy).toBe("revenue_growth");
    expect(replaceMutation!.childPersuasionStrategy).not.toBe(replaceMutation!.parentPersuasionStrategy);

    spy.mockRestore();
  });

  it("depth cap: a depth=4 parent produces a depth=5 child, which is then ineligible in the next run", async () => {
    await seedTotalSent(300);

    // Seed a single human template at depth 4 and one other to meet the ≥2 minimum
    const [depth4] = await db.insert(promptTemplates).values({
      name: "Depth 4 Template",
      systemPrompt: "Depth 4.",
      templateType: "initial",
      active: true,
      createdBy: "user",
      generationDepth: 4,
      sendCount: 100,
      positiveIntentCount: 5, // low rate → replace candidate
    }).returning();

    await db.insert(promptTemplates).values({
      name: "Other Template",
      systemPrompt: "Other.",
      templateType: "initial",
      active: true,
      createdBy: "user",
      generationDepth: 0,
      sendCount: 100,
      positiveIntentCount: 80, // high rate → refine candidate
    });

    const mutatorModule = await import("../src/services/mutator");
    const spy = spyOn(mutatorModule, "generateMutation").mockResolvedValue({
      ...MOCK_MUTATION_RESULT,
      mutationMode: "replace",
    });

    await runMutationRunner();

    // Child should exist at depth 5
    const [child] = await db.select().from(promptTemplates)
      .where(eq(promptTemplates.parentTemplateId, depth4.id));
    expect(child).toBeDefined();
    expect(child.generationDepth).toBe(5);

    // Second run: child at depth 5 must NOT be selected (depth < 5 fails)
    spy.mockReset();
    await runMutationRunner();

    const calledWithIds = spy.mock.calls.map(call => call[0] as string);
    expect(calledWithIds).not.toContain(child.id);

    spy.mockRestore();
  });
});
```
