import { Agent } from "@mastra/core/agent";
import { HAIKU_PINNED } from "../model";

// The full tuned prompt embeds the current date, so the service overrides
// `instructions` on every generate() call; this base string is a fallback only.
export const replyClassifierAgent = new Agent({
  id: "reply-classifier",
  name: "Reply Classifier",
  instructions: "You are classifying replies to cold marketing emails.",
  model: HAIKU_PINNED,
});
