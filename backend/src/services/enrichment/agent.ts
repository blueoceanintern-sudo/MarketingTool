import { RequestContext } from "@mastra/core/request-context";
import { enrichmentAgent } from "../../mastra/agents/enrichment.agent";
import {
  BROWSER_DRIVER_KEY,
  FINISH_RESULT_KEY,
  type FinishBox,
} from "../../mastra/tools/browser.tools";
import type { BrowserDriver } from "./browserDriver";

const MAX_STEPS = 12;

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

  const finishBox: FinishBox = { value: undefined };
  const requestContext = new RequestContext();
  requestContext.set(BROWSER_DRIVER_KEY, opts.driver);
  requestContext.set(FINISH_RESULT_KEY, finishBox);

  const response = await enrichmentAgent.generate(opts.task, {
    // Cache the static prefix (tools + system) once and reuse it across every
    // step of this run; only the mutating message history stays uncached.
    instructions: {
      role: "system",
      content: opts.systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    requestContext,
    maxSteps: MAX_STEPS,
    modelSettings: { maxOutputTokens: 1024 },
  });

  const steps = response.steps?.length ?? 0;

  if (finishBox.value !== undefined) {
    return { result: finishBox.value as T, steps, reason: "finished" };
  }
  if (steps >= MAX_STEPS) {
    return { result: null, steps, reason: "max_steps" };
  }
  return { result: null, steps, reason: "error" };
}
