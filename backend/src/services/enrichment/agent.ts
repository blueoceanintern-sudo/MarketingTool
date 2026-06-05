import Anthropic from "@anthropic-ai/sdk";
import type { BrowserDriver } from "./browserDriver";

const MAX_STEPS = 12;
const MODEL = "claude-haiku-4-5";

// read_page returns up to ~20k chars (~6k tokens) and otherwise lingers in the
// message history, getting resent every step. We keep only the most recent page
// dump verbatim and replace older ones with a stub — the agent's own assistant
// turns retain what it concluded from those pages.
const KEEP_RECENT_PAGE_READS = 1;
const EVICTED_PAGE_STUB = JSON.stringify({
  text: "[earlier page text evicted to save context — re-read the page if you still need it]",
});

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "navigate",
    description: "Open a URL in the browser. Use full https:// URLs.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "read_page",
    description: "Return the visible text of the current page (truncated to ~20k chars).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "click_text",
    description: "Click the first element containing the given text. Returns whether the click succeeded.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "finish",
    description:
      "Return the final structured result and end the task. Call exactly once when extraction is complete or no further progress is possible.",
    input_schema: {
      type: "object",
      properties: { result: { type: "object" } },
      required: ["result"],
    },
  },
];

interface AgentRun<T> {
  result: T | null;
  steps: number;
  reason: "finished" | "max_steps" | "error";
}

export async function runBrowserAgent<T>(opts: {
  driver: BrowserDriver;
  systemPrompt: string;
  task: string;
}): Promise<AgentRun<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: opts.task },
  ];
  // Ordered tool_use ids of read_page calls, used to evict stale page dumps.
  const pageReadIds: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Cache the static prefix (tools + system) once and reuse it across every
      // step of this run; only the mutating message history stays uncached.
      system: [{ type: "text", text: opts.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { result: null, steps: step + 1, reason: "finished" };
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "finish") {
        const input = block.input as { result?: T };
        return { result: input.result ?? null, steps: step + 1, reason: "finished" };
      }

      const output = await dispatchTool(opts.driver, block.name, block.input as Record<string, unknown>);
      if (block.name === "read_page") pageReadIds.push(block.id);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof output === "string" ? output : JSON.stringify(output),
      });
    }

    messages.push({ role: "user", content: toolResults });
    evictStalePageReads(messages, pageReadIds);
  }

  return { result: null, steps: MAX_STEPS, reason: "max_steps" };
}

// Replace every read_page result except the most recent KEEP_RECENT_PAGE_READS
// with a small stub, in place, so old page dumps stop riding along in each
// step's request. Mutates the message blocks directly.
function evictStalePageReads(
  messages: Anthropic.Messages.MessageParam[],
  pageReadIds: string[],
): void {
  if (pageReadIds.length <= KEEP_RECENT_PAGE_READS) return;
  const stale = new Set(pageReadIds.slice(0, pageReadIds.length - KEEP_RECENT_PAGE_READS));

  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_result" && stale.has(block.tool_use_id) && block.content !== EVICTED_PAGE_STUB) {
        block.content = EVICTED_PAGE_STUB;
      }
    }
  }
}

async function dispatchTool(
  driver: BrowserDriver,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case "navigate": {
        const url = String(input.url ?? "");
        if (!url.startsWith("https://")) return { error: "url must start with https://" };
        await driver.navigate(url);
        return { ok: true, url: driver.currentUrl() };
      }
      case "read_page": {
        const text = await driver.readPage();
        return { text, url: driver.currentUrl() };
      }
      case "click_text": {
        const ok = await driver.clickText(String(input.text ?? ""));
        return { ok, url: driver.currentUrl() };
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
