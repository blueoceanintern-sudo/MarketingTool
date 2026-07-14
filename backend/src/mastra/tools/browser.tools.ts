import { createTool } from "@mastra/core/tools";
import type { InputProcessor } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import type { BrowserDriver } from "../../services/enrichment/browserDriver";

// Request-context keys the enrichment service sets per run.
export const BROWSER_DRIVER_KEY = "browserDriver";
export const FINISH_RESULT_KEY = "finishResult";

export interface FinishBox {
  value: unknown;
}

function getDriver(requestContext: RequestContext | undefined): BrowserDriver | null {
  const driver = requestContext?.get(BROWSER_DRIVER_KEY);
  return (driver as BrowserDriver | undefined) ?? null;
}

export const navigateTool = createTool({
  id: "navigate",
  description: "Open a URL in the browser. Use full https:// URLs.",
  inputSchema: z.object({ url: z.string() }),
  execute: async (inputData, context) => {
    const driver = getDriver(context?.requestContext);
    if (!driver) return { error: "no browser driver available" };
    try {
      const url = String(inputData.url ?? "");
      if (!url.startsWith("https://")) return { error: "url must start with https://" };
      await driver.navigate(url);
      return { ok: true, url: driver.currentUrl() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const readPageTool = createTool({
  id: "read_page",
  description: "Return the visible text of the current page (truncated to ~20k chars).",
  inputSchema: z.object({}),
  execute: async (_inputData, context) => {
    const driver = getDriver(context?.requestContext);
    if (!driver) return { error: "no browser driver available" };
    try {
      const text = await driver.readPage();
      return { text, url: driver.currentUrl() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const clickTextTool = createTool({
  id: "click_text",
  description: "Click the first element containing the given text. Returns whether the click succeeded.",
  inputSchema: z.object({ text: z.string() }),
  execute: async (inputData, context) => {
    const driver = getDriver(context?.requestContext);
    if (!driver) return { error: "no browser driver available" };
    try {
      const ok = await driver.clickText(String(inputData.text ?? ""));
      return { ok, url: driver.currentUrl() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const finishTool = createTool({
  id: "finish",
  description:
    "Return the final structured result and end the task. Call exactly once when extraction is complete or no further progress is possible.",
  inputSchema: z.object({ result: z.record(z.string(), z.unknown()) }),
  execute: async (inputData, context) => {
    const box = context?.requestContext?.get(FINISH_RESULT_KEY) as FinishBox | undefined;
    if (box) box.value = inputData.result;
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Page-read eviction — ports services/enrichment/agent.ts's context eviction.
// read_page returns up to ~20k chars (~6k tokens) that would otherwise ride
// along in the message history on every step. Keep only the most recent page
// dump verbatim and replace older ones with a stub; the agent's own assistant
// turns retain what it concluded from those pages.
// ---------------------------------------------------------------------------

const KEEP_RECENT_PAGE_READS = 1;
const EVICTED_PAGE_STUB = {
  text: "[earlier page text evicted to save context — re-read the page if you still need it]",
};

export const pageReadEvictionProcessor: InputProcessor = {
  id: "page-read-eviction",
  processInputStep({ messages }) {
    const pageReads: { toolInvocation: { result?: unknown } }[] = [];
    for (const msg of messages) {
      for (const part of msg.content.parts) {
        if (
          part.type === "tool-invocation" &&
          part.toolInvocation.toolName === "read_page" &&
          part.toolInvocation.state === "result"
        ) {
          pageReads.push(part);
        }
      }
    }
    if (pageReads.length <= KEEP_RECENT_PAGE_READS) return messages;
    for (const part of pageReads.slice(0, pageReads.length - KEEP_RECENT_PAGE_READS)) {
      part.toolInvocation.result = EVICTED_PAGE_STUB;
    }
    return messages;
  },
};
