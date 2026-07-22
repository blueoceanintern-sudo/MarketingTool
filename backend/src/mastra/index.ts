import { Mastra } from "@mastra/core/mastra";
import { emailDrafterAgent } from "./agents/email-drafter.agent";
import { emailScorerAgent } from "./agents/email-scorer.agent";
import { enrichmentAgent } from "./agents/enrichment.agent";
import { mutatorAgent } from "./agents/mutator.agent";
import { replyClassifierAgent } from "./agents/reply-classifier.agent";
import { campaignPlannerAgent } from "./agents/campaign-planner.agent";
import { leadDiscoveryAgent } from "./agents/lead-discovery.agent";

export const mastra = new Mastra({
  // Explicit port: the backend's own PORT=3001 (.env) would otherwise collide,
  // since `mastra dev` always reloads .env and overrides process.env.PORT.
  server: {
    port: 4111,
  },
  agents: {
    emailDrafterAgent,
    emailScorerAgent,
    enrichmentAgent,
    mutatorAgent,
    replyClassifierAgent,
    campaignPlannerAgent,
    leadDiscoveryAgent,
  },
});
