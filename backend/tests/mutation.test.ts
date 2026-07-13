import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../src/db";
import { promptTemplates, companies, leads, campaigns, campaignLeads, emailDrafts, emailEvents } from "../src/db/schema";
import { generateMutation } from "../src/services/mutator";
import { eq } from "drizzle-orm";

// Live API test — requires ANTHROPIC_API_KEY and TEST_DATABASE_URL.
// Run with:
//   TEST_DATABASE_URL=... ANTHROPIC_API_KEY=... bun test tests/mutation.test.ts

// ── Reset ─────────────────────────────────────────────────────────────────────

async function resetTables() {
  await db.delete(emailEvents);
  await db.delete(emailDrafts);
  await db.delete(campaignLeads);
  await db.delete(leads);
  await db.delete(campaigns);
  await db.delete(companies);
  await db.delete(promptTemplates);
}

// ── Seed ──────────────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = [
  "You write short B2B cold outreach emails for BlueOcean, a workflow automation tool for schools.",
  "",
  "You will receive lead data (name, role, company, industry, location).",
  "Write a personalised cold email under 125 words.",
  "",
  "Output ONLY valid JSON — no preamble, no markdown fences:",
  '{"subject": "...", "body": "..."}',
  "",
  "Rules:",
  "- Max 125 words in body",
  "- No bullet points",
  "- Active voice",
  "- One clear CTA",
  "- No fabricated stats or client names",
  "- Target: school principals and admin directors in Singapore",
].join("\n");

async function seedTemplate(overrides: {
  sendCount: number;
  positiveIntentCount: number;
  name?: string;
}) {
  const [tmpl] = await db.insert(promptTemplates).values({
    name: overrides.name ?? "Test Template",
    systemPrompt: BASE_SYSTEM_PROMPT,
    description: "pain/problem framing — focuses on manual admin overhead",
    templateType: "initial",
    active: true,
    createdBy: "user",
    generationDepth: 0,
    sendCount: overrides.sendCount,
    positiveIntentCount: overrides.positiveIntentCount,
    negativeReplyCount: 0,
    spamComplaintCount: 0,
  }).returning();
  return tmpl;
}

// Builds a ranked template list with the target at a specific index.
// generateMutation uses: percentile = idx / (total - 1)
//   index 0 of 20   → 0%    → top tier    (refine 1 dim)
//   index 3 of 20   → 15.8% → winner tier (refine 2 dim or replace with 20% chance)
//   index 15 of 20  → 78.9% → loser tier  (replace)
//   index 10 of 20  → 52.6% → middle tier (skip → null)
function buildRankedList(targetId: string, targetIndex: number, total: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: i === targetIndex ? targetId : `placeholder-${i}`,
    sendCount: 100,
    positiveIntentCount: Math.floor(100 * (1 - i / total)),
    systemPrompt: BASE_SYSTEM_PROMPT,
    description: "placeholder",
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateMutation", () => {
  beforeEach(async () => {
    await resetTables();
  });

  it("returns null when the parent template does not exist in the DB", async () => {
    const result = await generateMutation(
      "00000000-0000-0000-0000-000000000000",
      [{ id: "00000000-0000-0000-0000-000000000000", sendCount: 100, positiveIntentCount: 10, systemPrompt: BASE_SYSTEM_PROMPT }],
    );
    expect(result).toBeNull();
  }, 10_000);

  it("returns null for a middle-tier template (no API call made)", async () => {
    const tmpl = await seedTemplate({ sendCount: 100, positiveIntentCount: 50 });
    // index 10 of 20 → percentile 52.6% → middle 50% → skip
    const ranked = buildRankedList(tmpl.id, 10, 20);
    const result = await generateMutation(tmpl.id, ranked);
    expect(result).toBeNull();
  }, 10_000);

  it("replace mode (bottom 25%): uses a different persuasion strategy and changes ≥4 dimensions", async () => {
    const tmpl = await seedTemplate({ sendCount: 100, positiveIntentCount: 5, name: "Underperformer" });
    // index 15 of 20 → percentile 78.9% → loser tier → replace
    const ranked = buildRankedList(tmpl.id, 15, 20);

    const result = await generateMutation(tmpl.id, ranked);

    expect(result).not.toBeNull();
    expect(result!.mutationMode).toBe("replace");
    expect(result!.systemPrompt.length).toBeGreaterThan(0);
    expect(result!.systemPrompt).not.toBe(BASE_SYSTEM_PROMPT);

    // Replace must switch to a genuinely different strategy
    expect(result!.childPersuasionStrategy).not.toBe(result!.parentPersuasionStrategy);

    // Replace requires ≥4 dimension changes
    expect(result!.dimensionsChanged.length).toBeGreaterThanOrEqual(4);

    // All required string fields are present and non-empty
    expect(result!.name.length).toBeGreaterThan(0);
    expect(result!.description.length).toBeGreaterThan(0);
    expect(result!.mutationReason.length).toBeGreaterThan(0);
    expect(result!.hypothesisTested.length).toBeGreaterThan(0);
    expect(result!.mutationDistance).toBe("high");
  }, 60_000);

  it("refine mode (top 5%): preserves persuasion strategy and changes exactly 1 dimension", async () => {
    const tmpl = await seedTemplate({ sendCount: 100, positiveIntentCount: 90, name: "Top Performer" });
    // index 0 of 20 → percentile 0% → top tier → refine 1 dim
    const ranked = buildRankedList(tmpl.id, 0, 20);

    const result = await generateMutation(tmpl.id, ranked);

    expect(result).not.toBeNull();
    expect(result!.mutationMode).toBe("refine");
    expect(result!.systemPrompt.length).toBeGreaterThan(0);

    // Refine preserves the same strategy
    expect(result!.childPersuasionStrategy).toBe(result!.parentPersuasionStrategy);

    // Top tier: exactly 1 dimension changed
    expect(result!.dimensionsChanged).toHaveLength(1);

    expect(result!.name.length).toBeGreaterThan(0);
    expect(result!.mutationDistance).toMatch(/^(low|medium)$/);
  }, 60_000);

  it("winner tier (5–25%): refines with 2 dimensions or replaces (20% diversity budget)", async () => {
    const tmpl = await seedTemplate({ sendCount: 100, positiveIntentCount: 80, name: "Winner" });
    // index 3 of 20 → percentile 15.8% → winner tier
    const ranked = buildRankedList(tmpl.id, 3, 20);

    const result = await generateMutation(tmpl.id, ranked);

    expect(result).not.toBeNull();
    // Winner tier is either refine (80%) or replace (20% diversity budget) — accept both
    expect(["refine", "replace"]).toContain(result!.mutationMode);
    expect(result!.systemPrompt.length).toBeGreaterThan(0);
    expect(result!.name.length).toBeGreaterThan(0);

    if (result!.mutationMode === "refine") {
      expect(result!.childPersuasionStrategy).toBe(result!.parentPersuasionStrategy);
      expect(result!.dimensionsChanged.length).toBeLessThanOrEqual(2);
    } else {
      expect(result!.childPersuasionStrategy).not.toBe(result!.parentPersuasionStrategy);
      expect(result!.dimensionsChanged.length).toBeGreaterThanOrEqual(4);
    }
  }, 60_000);
});
