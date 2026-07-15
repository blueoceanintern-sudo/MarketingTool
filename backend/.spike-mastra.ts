// Phase 0 spike — throwaway. Verifies under Bun + this tsconfig:
// 1. @mastra/core Agent constructs with a model-router string
// 2. structuredOutput generic typing (response.object) holds
// 3. per-call instructions override accepts providerOptions (anthropic cacheControl)
// 4. model router resolves the anthropic provider (expects auth error without a key)
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { HAIKU } from "./src/mastra/model";

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number(),
});

const agent = new Agent({
  id: "spike-agent",
  name: "Spike Agent",
  instructions: "You classify sentiment. Reply with JSON only.",
  model: HAIKU,
});

async function main(): Promise<void> {
  console.log("[spike] agent constructed OK:", agent.name);

  try {
    const response = await agent.generate("The product is great!", {
      instructions: {
        role: "system",
        content: "You classify sentiment of short texts.",
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      structuredOutput: {
        schema,
        errorStrategy: "fallback",
        fallbackValue: { sentiment: "neutral" as const, confidence: 0 },
      },
      modelSettings: { maxOutputTokens: 64 },
    });
    // Type-level check: response.object must be the zod-inferred type.
    const obj: { sentiment: "positive" | "negative" | "neutral"; confidence: number } | undefined =
      response.object;
    console.log("[spike] generate OK, object:", obj);
    console.log("[spike] usage:", JSON.stringify(response.usage));
  } catch (err) {
    console.log("[spike] generate threw (expected without ANTHROPIC_API_KEY):");
    console.log(String(err).slice(0, 400));
  }
}

await main();
