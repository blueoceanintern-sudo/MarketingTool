import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { promptTemplates } from "../src/db/schema";
import {
  thompsonSample,
  generateDraftsBatch,
  generateFollowUpBatch,
  type FollowUpRequest,
} from "../src/services/drafting";

// Live API test — requires ANTHROPIC_API_KEY and TEST_DATABASE_URL.
// generateFollowUpBatch uses the Anthropic Batch API and can take several minutes.
// Run with:
//   TEST_DATABASE_URL=... ANTHROPIC_API_KEY=... bun test tests/drafting.test.ts

// ── Reset / Seed ──────────────────────────────────────────────────────────────

async function resetTables() {
  await db.execute(sql`TRUNCATE TABLE
    follow_ups, email_events, email_drafts,
    campaign_leads, leads, campaigns, companies, prompt_templates
  CASCADE`);
}

async function seedTemplates() {
  const [initial] = await db.insert(promptTemplates).values({
    name: "Initial Cold Email",
    systemPrompt: [
      "You write short B2B cold outreach emails for BlueOcean, a school workflow automation tool.",
      "You will receive lead data. Write a personalised cold email strictly under 125 words.",
      "",
      "Output ONLY valid JSON — no preamble, no markdown fences:",
      '{"subject": "...", "body": "..."}',
      "",
      "Rules: no bullet points, active voice, one clear CTA, no fabricated stats.",
    ].join("\n"),
    templateType: "initial",
    active: true,
    createdBy: "user",
    sendCount: 50,
    positiveIntentCount: 15,
    negativeReplyCount: 2,
    spamComplaintCount: 0,
  }).returning();

  const [fu1] = await db.insert(promptTemplates).values({
    name: "Follow-up 1",
    systemPrompt: [
      "You write B2B follow-up emails strictly under 90 words.",
      "",
      "Output ONLY valid JSON — no preamble, no markdown fences:",
      '{"subject": "...", "body": "...", "angle_tag": "snake_case_tag"}',
      "",
      "The angle_tag is a short snake_case label for the persuasion angle used (e.g. manual_workload, roi_framing, social_proof, risk_reduction).",
    ].join("\n"),
    templateType: "followup_1",
    active: true,
    createdBy: "user",
    sendCount: 30,
    positiveIntentCount: 8,
    negativeReplyCount: 1,
    spamComplaintCount: 0,
  }).returning();

  const [fu2] = await db.insert(promptTemplates).values({
    name: "Follow-up 2",
    systemPrompt: [
      "You write second B2B follow-up emails strictly under 85 words. Use a different angle than any previous follow-ups.",
      "",
      "Output ONLY valid JSON — no preamble, no markdown fences:",
      '{"subject": "...", "body": "...", "angle_tag": "snake_case_tag"}',
      "",
      "The angle_tag is a short snake_case label for the new angle used.",
    ].join("\n"),
    templateType: "followup_2",
    active: true,
    createdBy: "user",
    sendCount: 20,
    positiveIntentCount: 4,
    negativeReplyCount: 0,
    spamComplaintCount: 0,
  }).returning();

  const [breakup] = await db.insert(promptTemplates).values({
    name: "Breakup Email",
    systemPrompt: [
      "You write B2B breakup emails — the final email in a sequence — strictly under 70 words.",
      "",
      "Output ONLY valid JSON — no preamble, no markdown fences:",
      '{"subject": "...", "body": "...", "angle_tag": "snake_case_tag"}',
      "",
      "Keep it brief, respectful, and leave the door open.",
    ].join("\n"),
    templateType: "breakup",
    active: true,
    createdBy: "user",
    sendCount: 15,
    positiveIntentCount: 2,
    negativeReplyCount: 0,
    spamComplaintCount: 0,
  }).returning();

  return { initial, fu1, fu2, breakup };
}

// ── thompsonSample ────────────────────────────────────────────────────────────
// Pure function — no API, no DB.

describe("thompsonSample", () => {
  const base = { sendCount: 0, positiveIntentCount: 0, negativeReplyCount: 0, spamComplaintCount: 0 };

  it("returns undefined for an empty pool", () => {
    expect(thompsonSample([])).toBeUndefined();
  });

  it("returns the only item in a single-item pool", () => {
    const item = { id: "a", ...base };
    expect(thompsonSample([item])).toBe(item);
  });

  it("soft-excludes a template with negativeReplyCount/sendCount > 5% when sendCount >= 30", () => {
    const bad  = { id: "bad",  sendCount: 30, positiveIntentCount: 0, negativeReplyCount: 5, spamComplaintCount: 0 }; // 16.7%
    const good = { id: "good", sendCount: 30, positiveIntentCount: 10, negativeReplyCount: 0, spamComplaintCount: 0 };
    // good is the only eligible template — must always be picked
    for (let i = 0; i < 50; i++) {
      expect(thompsonSample([bad, good])?.id).toBe("good");
    }
  });

  it("soft-excludes a template with spamComplaintCount/sendCount > 1% when sendCount >= 30", () => {
    const spammy = { id: "spammy", sendCount: 30, positiveIntentCount: 5, negativeReplyCount: 0, spamComplaintCount: 1 }; // 3.3%
    const clean  = { id: "clean",  sendCount: 30, positiveIntentCount: 5, negativeReplyCount: 0, spamComplaintCount: 0 };
    for (let i = 0; i < 50; i++) {
      expect(thompsonSample([spammy, clean])?.id).toBe("clean");
    }
  });

  it("does NOT exclude a high-negative-rate template when sendCount < 30 (insufficient signal)", () => {
    const newTmpl = { id: "new",  sendCount: 10, positiveIntentCount: 0, negativeReplyCount: 3, spamComplaintCount: 0 }; // 30% but too few sends
    const good    = { id: "good", sendCount: 30, positiveIntentCount: 5, negativeReplyCount: 0, spamComplaintCount: 0 };
    let sawNew = false;
    for (let i = 0; i < 200; i++) {
      if (thompsonSample([newTmpl, good])?.id === "new") { sawNew = true; break; }
    }
    expect(sawNew).toBe(true);
  });

  it("falls back to the full pool when all templates are excluded", () => {
    const bad1 = { id: "bad1", sendCount: 30, positiveIntentCount: 0, negativeReplyCount: 5, spamComplaintCount: 0 };
    const bad2 = { id: "bad2", sendCount: 30, positiveIntentCount: 0, negativeReplyCount: 5, spamComplaintCount: 0 };
    const result = thompsonSample([bad1, bad2]);
    expect(result).toBeDefined();
    expect(["bad1", "bad2"]).toContain(result?.id);
  });

  it("with equal priors, all templates appear over many draws (not degenerate)", () => {
    const items = ["a", "b", "c"].map(id => ({ id, ...base }));
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(thompsonSample(items)!.id);
    expect(seen.size).toBe(3);
  });
});

// ── generateDraftsBatch ───────────────────────────────────────────────────────
// Two Claude calls per test: one generation pass, one adversarial scoring pass.

describe("generateDraftsBatch", () => {
  let templateId: string;

  beforeEach(async () => {
    await resetTables();
    const { initial } = await seedTemplates();
    templateId = initial.id;
  });

  it("returns empty array for zero requests", async () => {
    expect(await generateDraftsBatch([])).toEqual([]);
  }, 10_000);

  it("happy path — all result fields are present and valid", async () => {
    const results = await generateDraftsBatch([{
      leadId: "lead-1",
      campaignId: "camp-1",
      lead: {
        name: "Alice Tan",
        role: "Principal",
        companyName: "Gamma School",
        industry: "education",
        companySize: "small",
        location: "Singapore",
      },
      campaign: {
        name: "SG Schools",
        description: "Help SG schools reduce admin overhead with automation.",
        painPoints: ["manual timetabling", "paper-based records"],
        callToAction: "Book a 15-min demo",
      },
    }]);

    expect(results).toHaveLength(1);
    const r = results[0];

    // IDs pass through unchanged
    expect(r.leadId).toBe("lead-1");
    expect(r.campaignId).toBe("camp-1");
    expect(r.templateId).toBe(templateId);

    // Content is non-empty
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThan(0);

    // Word limit
    expect(r.body.trim().split(/\s+/).length).toBeLessThanOrEqual(125);

    // lengthCompliance is 25 (within limit) or 0 (over limit)
    expect([0, 25]).toContain(r.scoreBreakdown.lengthCompliance);

    // Each score component in range
    const { painPointFit, campaignAlignment, personalisationQuality, lengthCompliance } = r.scoreBreakdown;
    for (const s of [painPointFit, campaignAlignment, personalisationQuality]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(25);
    }

    // confidenceScore = sum of all 4 components
    expect(r.confidenceScore).toBe(painPointFit + campaignAlignment + personalisationQuality + lengthCompliance);
  }, 60_000);

  it("generates multiple independent drafts — different leads produce different subjects", async () => {
    const results = await generateDraftsBatch([
      {
        leadId: "lead-1",
        campaignId: "camp-1",
        lead: { name: "Alice Tan", role: "Principal", companyName: "Gamma School", industry: "education", companySize: "small", location: "Singapore" },
        campaign: { description: "Reduce school admin.", painPoints: ["paper records"], callToAction: "Book a demo" },
      },
      {
        leadId: "lead-2",
        campaignId: "camp-1",
        lead: { name: "Bob Chen", role: "CTO", companyName: "TechCorp", industry: "technology", companySize: "medium", location: "Sydney" },
        campaign: { description: "Speed up tech ops.", painPoints: ["slow deploys"], callToAction: "Let's talk" },
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.leadId).sort()).toEqual(["lead-1", "lead-2"]);
    expect(results[0].subject).not.toBe(results[1].subject);
  }, 60_000);
});

// ── generateFollowUpBatch ─────────────────────────────────────────────────────
// Uses the Anthropic Batch API — each test polls until the batch ends.
// Processing typically takes 1–5 minutes for small batches.

describe("generateFollowUpBatch", () => {
  beforeEach(async () => {
    await resetTables();
    await seedTemplates();
  });

  const makeRequest = (overrides: Partial<FollowUpRequest> = {}): FollowUpRequest => ({
    followUpId: "fu-1",
    leadId: "lead-1",
    campaignId: "camp-1",
    lead: {
      name: "Alice Tan",
      role: "Principal",
      companyName: "Gamma School",
      industry: "education",
      companySize: "small",
      location: "Singapore",
    },
    campaign: {
      name: "SG Schools",
      description: "Reduce school admin overhead with automation.",
      painPoints: ["manual timetabling", "paper-based records"],
      callToAction: "Book a 15-min demo",
    },
    attemptNumber: 1,
    originalSubject: "Helping SG schools save time on admin",
    previousAngleTags: [],
    ...overrides,
  });

  it("returns empty array for zero requests", async () => {
    expect(await generateFollowUpBatch([])).toEqual([]);
  }, 10_000);

  it("attempt 1 (followup_1): valid fields, body ≤90 words, angleTag non-empty", async () => {
    const results = await generateFollowUpBatch([makeRequest({ attemptNumber: 1 })]);

    expect(results).toHaveLength(1);
    const r = results[0];

    expect(r.followUpId).toBe("fu-1");
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.angleTag.length).toBeGreaterThan(0);
    expect(r.body.trim().split(/\s+/).length).toBeLessThanOrEqual(90);

    const { painPointFit, campaignAlignment, personalisationQuality, lengthCompliance } = r.scoreBreakdown;
    for (const s of [painPointFit, campaignAlignment, personalisationQuality]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(25);
    }
    expect([0, 25]).toContain(lengthCompliance);
  }, 600_000);

  it("attempt 2 (followup_2): body ≤85 words", async () => {
    const results = await generateFollowUpBatch([
      makeRequest({ followUpId: "fu-2", attemptNumber: 2, previousAngleTags: ["manual_workload"] }),
    ]);
    expect(results[0].body.trim().split(/\s+/).length).toBeLessThanOrEqual(85);
  }, 600_000);

  it("attempt 3 (breakup): body ≤70 words", async () => {
    const results = await generateFollowUpBatch([
      makeRequest({ followUpId: "fu-3", attemptNumber: 3, previousAngleTags: ["manual_workload", "roi_framing"] }),
    ]);
    expect(results[0].body.trim().split(/\s+/).length).toBeLessThanOrEqual(70);
  }, 600_000);
});
