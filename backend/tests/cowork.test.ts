import { describe, it, expect, mock } from "bun:test";
import type { BrowserDriver } from "../src/services/enrichment/browserDriver";

process.env.ANTHROPIC_API_KEY = "test_key";

interface MessagesCreateArgs {
  messages: Array<{ role: string; content: unknown }>;
}

interface MockResponse {
  content: Array<{ type: string; name?: string; id?: string; input?: unknown }>;
  stop_reason: string;
}

// Mock the Anthropic SDK before importing the agent.
const responses: MockResponse[] = [];
let callCount = 0;
let lastMessages: unknown = null;

await mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (args: MessagesCreateArgs) => {
        lastMessages = args.messages;
        const r = responses[callCount++];
        if (!r) throw new Error("no mock response queued");
        return r;
      },
    };
  },
}));

const { runBrowserAgent } = await import("../src/services/enrichment/agent");

function fakeDriver(text: string): BrowserDriver {
  let url = "about:blank";
  return {
    navigate: async (u: string) => { url = u; },
    currentUrl: () => url,
    readPage: async () => text,
    clickText: async () => true,
    close: async () => undefined,
  };
}

describe("runBrowserAgent", () => {
  it("dispatches navigate → read_page → finish and returns the structured result", async () => {
    callCount = 0;
    responses.length = 0;

    responses.push({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "navigate", input: { url: "https://example.com" } },
      ],
    });
    responses.push({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t2", name: "read_page", input: {} },
      ],
    });
    responses.push({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t3",
          name: "finish",
          input: {
            result: {
              institution: { name: "Acme School", type: "private_school", region: "SG" },
              contact: { email: "info@acme.sg", email_status: "verified" },
            },
          },
        },
      ],
    });

    const run = await runBrowserAgent({
      driver: fakeDriver("Welcome to Acme School. Email: info@acme.sg"),
      systemPrompt: "test",
      task: "extract data",
    });

    expect(run.reason).toBe("finished");
    expect(run.steps).toBe(3);
    expect((run.result as any).contact.email).toBe("info@acme.sg");
    expect((run.result as any).contact.email_status).toBe("verified");
  });

  it("rejects non-https navigate input via tool_result error and continues", async () => {
    callCount = 0;
    responses.length = 0;

    responses.push({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "navigate", input: { url: "http://insecure.com" } }],
    });
    responses.push({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t2", name: "finish", input: { result: { ok: false } } }],
    });

    const run = await runBrowserAgent({
      driver: fakeDriver(""),
      systemPrompt: "test",
      task: "test",
    });

    expect(run.reason).toBe("finished");
    // second user-turn carries the tool_result with the error
    const turns = lastMessages as Array<{ role: string; content: unknown }>;
    const toolResultTurn = turns.find((t) => t.role === "user" && Array.isArray(t.content)) as
      | { content: Array<{ content: string }> }
      | undefined;
    expect(toolResultTurn?.content[0]?.content).toContain("url must start with https://");
  });
});
