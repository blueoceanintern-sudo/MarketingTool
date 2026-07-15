import { Agent } from "@mastra/core/agent";
import { HAIKU } from "../model";

// The real system prompt is a Thompson-sampled template loaded from the DB,
// so the drafting service overrides `instructions` on every generate() call
// (with Anthropic cacheControl so repeated templates hit the prompt cache).
export const emailDrafterAgent = new Agent({
  id: "email-drafter",
  name: "Email Drafter",
  instructions: "You write short, personalised B2B cold outreach emails.",
  model: HAIKU,
});
