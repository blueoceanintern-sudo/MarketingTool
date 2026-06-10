import { describe, it, expect, mock, beforeEach } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test_api_key";

// Mock the DB so generateDraftsBatch can read active templates without a
// real Postgres connection. The drafting service does:
//   db.select(...).from(promptTemplates).where(eq(active, true))
// so we return a chainable shape that resolves to a fixed template list.
const fakeTemplates = [{ id: "tmpl_default", systemPrompt: "test system prompt", weight: 1 }];

mock.module("../src/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(fakeTemplates),
      }),
    }),
  },
}));

// Results yielded by the mock batch results async generator — configured per test
let batchResultItems: object[] = [];

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor(_opts: object) {}
    messages = {
      batches: {
        create: mock(() =>
          Promise.resolve({ id: "msgbatch_test_001", processing_status: "ended" })
        ),
        retrieve: mock(() => Promise.resolve({ processing_status: "ended" })),
        results: mock(() => {
          const items = [...batchResultItems];
          async function* gen() {
            for (const item of items) yield item;
          }
          return Promise.resolve(gen());
        }),
      },
    };
  },
}));

const { generateDraftsBatch } = await import("../src/services/drafting/index");

function succeededItem(customId: string, json: object) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded",
      message: { content: [{ type: "text", text: JSON.stringify(json) }] },
    },
  };
}

const baseRequest = {
  leadId: "lead_a",
  campaignId: "camp_x",
  lead: { name: "Jane", role: "CTO", companyName: "Acme", industry: "SaaS" },
};

describe("drafting — generateDraftsBatch", () => {
  beforeEach(() => { batchResultItems = []; });

  it("returns a parsed DraftResult tagged with the picked templateId", async () => {
    batchResultItems = [
      succeededItem("lead_a:camp_x:tmpl_default", {
        subject: "Quick question about your dev workflow",
        body: "Hi Jane, noticed your team is growing. We reduce integration overhead. Worth a 15-min chat?",
        confidenceScore: 85,
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);

    expect(results).toHaveLength(1);
    expect(results[0]!.leadId).toBe("lead_a");
    expect(results[0]!.campaignId).toBe("camp_x");
    expect(results[0]!.templateId).toBe("tmpl_default");
    expect(results[0]!.subject).toBe("Quick question about your dev workflow");
    expect(results[0]!.confidenceScore).toBe(85);
  });

  it("penalises confidenceScore by 20 when body exceeds 125 words", async () => {
    const longBody = Array.from({ length: 130 }, (_, i) => `word${i}`).join(" ");
    batchResultItems = [
      succeededItem("lead_a:camp_x:tmpl_default", {
        subject: "Long email",
        body: longBody,
        confidenceScore: 90,
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);

    expect(results[0]!.confidenceScore).toBe(70); // 90 - 20
  });

  it("does not penalise confidenceScore when body is exactly 125 words", async () => {
    const exactBody = Array.from({ length: 125 }, () => "word").join(" ");
    batchResultItems = [
      succeededItem("lead_a:camp_x:tmpl_default", {
        subject: "Exact length",
        body: exactBody,
        confidenceScore: 80,
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results[0]!.confidenceScore).toBe(80);
  });

  it("skips batch items whose result type is not 'succeeded'", async () => {
    batchResultItems = [
      {
        custom_id: "lead_a:camp_x:tmpl_default",
        result: { type: "errored", error: { type: "server_error", message: "timeout" } },
      },
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results).toHaveLength(0);
  });

  it("skips items with malformed JSON in the response text", async () => {
    batchResultItems = [
      {
        custom_id: "lead_a:camp_x:tmpl_default",
        result: {
          type: "succeeded",
          message: { content: [{ type: "text", text: "not valid json {{ }" }] },
        },
      },
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results).toHaveLength(0);
  });

  it("skips items where required fields are missing from the JSON", async () => {
    batchResultItems = [
      succeededItem("lead_a:camp_x:tmpl_default", {
        subject: "Only subject, no body or score",
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results).toHaveLength(0);
  });

  it("handles multiple items in one batch and returns all valid results", async () => {
    batchResultItems = [
      succeededItem("l1:c1:tmpl_default", { subject: "Sub1", body: "Short body one", confidenceScore: 75 }),
      succeededItem("l2:c1:tmpl_default", { subject: "Sub2", body: "Short body two", confidenceScore: 65 }),
    ];

    const results = await generateDraftsBatch([
      { leadId: "l1", campaignId: "c1", lead: {} },
      { leadId: "l2", campaignId: "c1", lead: {} },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.leadId)).toContain("l1");
    expect(results.map((r) => r.leadId)).toContain("l2");
  });

  it("returns an empty array when given no requests (skips API call)", async () => {
    const results = await generateDraftsBatch([]);
    expect(results).toHaveLength(0);
  });
});
