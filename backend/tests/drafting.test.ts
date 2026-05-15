import { describe, it, expect, mock, beforeEach } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test_api_key";

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
  persona: "technical" as const,
  lead: { firstName: "Jane", role: "CTO", companyName: "Acme", industry: "SaaS" },
};

describe("drafting — generateDraftsBatch", () => {
  beforeEach(() => { batchResultItems = []; });

  it("returns a parsed DraftResult for a successful batch item", async () => {
    batchResultItems = [
      succeededItem("lead_a:camp_x:technical", {
        subject: "Quick question about your dev workflow",
        body: "Hi Jane, noticed your team is growing. We reduce integration overhead. Worth a 15-min chat?",
        confidenceScore: 85,
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);

    expect(results).toHaveLength(1);
    expect(results[0]!.leadId).toBe("lead_a");
    expect(results[0]!.campaignId).toBe("camp_x");
    expect(results[0]!.persona).toBe("technical");
    expect(results[0]!.subject).toBe("Quick question about your dev workflow");
    expect(results[0]!.confidenceScore).toBe(85);
  });

  it("penalises confidenceScore by 20 when body exceeds 125 words", async () => {
    const longBody = Array.from({ length: 130 }, (_, i) => `word${i}`).join(" ");
    batchResultItems = [
      succeededItem("lead_a:camp_x:technical", {
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
      succeededItem("lead_a:camp_x:technical", {
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
        custom_id: "lead_a:camp_x:technical",
        result: { type: "errored", error: { type: "server_error", message: "timeout" } },
      },
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results).toHaveLength(0);
  });

  it("skips items with malformed JSON in the response text", async () => {
    batchResultItems = [
      {
        custom_id: "lead_a:camp_x:technical",
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
      succeededItem("lead_a:camp_x:technical", {
        subject: "Only subject, no body or score",
      }),
    ];

    const results = await generateDraftsBatch([baseRequest]);
    expect(results).toHaveLength(0);
  });

  it("handles multiple items in one batch and returns all valid results", async () => {
    batchResultItems = [
      succeededItem("l1:c1:technical", { subject: "Sub1", body: "Short body one", confidenceScore: 75 }),
      succeededItem("l2:c1:ops", { subject: "Sub2", body: "Short body two", confidenceScore: 65 }),
    ];

    const results = await generateDraftsBatch([
      { leadId: "l1", campaignId: "c1", persona: "technical", lead: {} },
      { leadId: "l2", campaignId: "c1", persona: "ops", lead: {} },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.leadId)).toContain("l1");
    expect(results.map((r) => r.leadId)).toContain("l2");
  });

  it("uses the correct persona in the returned result", async () => {
    batchResultItems = [
      succeededItem("lead_a:camp_x:executive", {
        subject: "Revenue impact",
        body: "ROI focused body content here.",
        confidenceScore: 78,
      }),
    ];

    const results = await generateDraftsBatch([
      { ...baseRequest, persona: "executive" as const },
    ]);

    expect(results[0]!.persona).toBe("executive");
  });
});
