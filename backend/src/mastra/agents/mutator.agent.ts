import { Agent } from "@mastra/core/agent";
import { HAIKU_PINNED } from "../model";

// The mutation task (parent template, performance stats, taxonomy, output
// format) is delivered entirely in the user message, matching the original
// raw-SDK call which sent no system prompt.
export const mutatorAgent = new Agent({
  id: "template-mutator",
  name: "Template Mutator",
  instructions: "You create variations of outbound B2B cold email prompt templates.",
  model: HAIKU_PINNED,
});
