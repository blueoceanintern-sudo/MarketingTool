import { Agent } from "@mastra/core/agent";
import { HAIKU } from "../model";
import {
  navigateTool,
  readPageTool,
  clickTextTool,
  finishTool,
  pageReadEvictionProcessor,
} from "../tools/browser.tools";

// Browser enrichment agent. The caller (services/enrichment/agent.ts)
// overrides `instructions` per run with the provider's tuned system prompt
// and supplies the BrowserDriver + finish box via requestContext.
export const enrichmentAgent = new Agent({
  id: "enrichment-browser",
  name: "Enrichment Browser Agent",
  instructions: "You are a B2B lead enrichment agent that browses websites to verify contact data.",
  model: HAIKU,
  tools: {
    navigate: navigateTool,
    read_page: readPageTool,
    click_text: clickTextTool,
    finish: finishTool,
  },
  inputProcessors: [pageReadEvictionProcessor],
});
